/**
 * PPPP packet framing, ported from the reference `libflagship/pppp.py`.
 *
 * PPPP is the custom P2P-over-UDP protocol the M5 uses for LAN file upload and
 * camera streaming. Every datagram is a `0xF1`-magic message: `F1 <type> <size>`
 * then a type-specific body. Reliable bulk transfer rides on DRW/DRW_ACK packets
 * (see channel.ts); file payloads are wrapped in `XZYH` and `AABB` frames.
 *
 * Pure framing — pack/parse round-trips are unit-tested without a printer.
 */
import { BufReader, BufWriter } from "../../binary.js";
import { cryptoCurseString, ppcsCrc16, simpleDecrypt } from "../../crypto.js";

const MSG_MAGIC = 0xf1;

export enum PpppType {
  HELLO = 0x00,
  HELLO_ACK = 0x01,
  DEV_LGN_CRC = 0x12,
  DEV_LGN_ACK_CRC = 0x13,
  LAN_SEARCH = 0x30,
  PUNCH_TO = 0x40,
  PUNCH_PKT = 0x41,
  P2P_RDY = 0x42,
  P2P_RDY_ACK = 0x43,
  DRW = 0xd0,
  DRW_ACK = 0xd1,
  ALIVE = 0xe0,
  ALIVE_ACK = 0xe1,
  CLOSE = 0xf0,
  REPORT_SESSION_READY = 0xf9,
}

export enum P2PCmdType {
  P2P_SEND_FILE = 0x3a98,
}

export enum FileTransfer {
  BEGIN = 0x00, // sent with metadata
  DATA = 0x01, // file content
  END = 0x02, // complete transfer → start printing
  ABORT = 0x03, // abort + delete file
  REPLY = 0x80, // reply from printer
}

export enum FileTransferReply {
  OK = 0x00,
  ERR_TIMEOUT = 0xfc,
  ERR_FRAME_TYPE = 0xfd,
  ERR_WRONG_MD5 = 0xfe,
  ERR_BUSY = 0xff,
}

// ---------------------------------------------------------------------------
// Duid (device id, e.g. "USPRAKM-000994-YYLLG")
// ---------------------------------------------------------------------------

export interface Duid {
  prefix: string;
  serial: number;
  check: string;
}

export function parseDuidString(s: string): Duid {
  const [prefix, serial, check] = s.split("-");
  return { prefix: prefix ?? "", serial: Number(serial ?? 0), check: check ?? "" };
}

export function duidToString(d: Duid): string {
  return `${d.prefix}-${String(d.serial).padStart(6, "0")}-${d.check}`;
}

function writeDuid(w: BufWriter, d: Duid): void {
  w.string(d.prefix, 8).u32be(d.serial).string(d.check, 6).zeroes(2);
}

function readDuid(r: BufReader): Duid {
  const prefix = r.string(8);
  const serial = r.u32be();
  const check = r.string(6);
  r.zeroes(2);
  return { prefix, serial, check };
}

// ---------------------------------------------------------------------------
// Host (address record)
// ---------------------------------------------------------------------------

export interface Host {
  afam: number;
  port: number;
  addr: string;
}

function writeHost(w: BufWriter, h: Host): void {
  w.zeroes(1).u8(h.afam).u16le(h.port).ipv4(h.addr).zeroes(8);
}

const AF_INET = 2;
const ZERO_HOST: Host = { afam: AF_INET, port: 0, addr: "0.0.0.0" };

// ---------------------------------------------------------------------------
// Message wrapper: F1 <type> <size:u16be> <body>
// ---------------------------------------------------------------------------

function wrapMessage(type: PpppType, body: Buffer): Buffer {
  return new BufWriter().u8(MSG_MAGIC).u8(type).u16be(body.length).bytes(body).build();
}

export interface ParsedMessage {
  type: PpppType;
  body: Buffer;
  duid?: Duid;
  /** DRW fields. */
  chan?: number;
  index?: number;
  data?: Buffer;
  /** DRW_ACK fields. */
  acks?: number[];
}

/** Parse an inbound datagram into a typed message (subset we act on). */
export function parseMessage(buf: Buffer): ParsedMessage {
  const r = new BufReader(buf);
  const magic = r.u8();
  if (magic !== MSG_MAGIC) throw new Error(`bad PPPP magic: 0x${magic.toString(16)}`);
  const type = r.u8() as PpppType;
  const size = r.u16be();
  const body = r.bytes(size);
  const out: ParsedMessage = { type, body };

  switch (type) {
    case PpppType.PUNCH_PKT:
    case PpppType.P2P_RDY: {
      out.duid = readDuid(new BufReader(body));
      break;
    }
    case PpppType.DRW: {
      const b = new BufReader(body);
      b.magic(Buffer.from([0xd1]));
      out.chan = b.u8();
      out.index = b.u16be();
      out.data = b.tail();
      break;
    }
    case PpppType.DRW_ACK: {
      const b = new BufReader(body);
      b.magic(Buffer.from([0xd1]));
      out.chan = b.u8();
      const count = b.u16be();
      out.acks = Array.from({ length: count }, () => b.u16be());
      break;
    }
    case PpppType.REPORT_SESSION_READY: {
      // body is `simple`-encrypted; decode best-effort for diagnostics.
      try {
        out.duid = readDuid(new BufReader(simpleDecrypt(body)));
      } catch {
        /* ignore */
      }
      break;
    }
    default:
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Outbound packet builders
// ---------------------------------------------------------------------------

export const pktLanSearch = (): Buffer => wrapMessage(PpppType.LAN_SEARCH, Buffer.alloc(0));
export const pktClose = (): Buffer => wrapMessage(PpppType.CLOSE, Buffer.alloc(0));
export const pktAlive = (): Buffer => wrapMessage(PpppType.ALIVE, Buffer.alloc(0));
export const pktAliveAck = (): Buffer => wrapMessage(PpppType.ALIVE_ACK, Buffer.alloc(0));

export function pktP2pRdy(duid: Duid): Buffer {
  const w = new BufWriter();
  writeDuid(w, duid);
  return wrapMessage(PpppType.P2P_RDY, w.build());
}

export function pktP2pRdyAck(duid: Duid, host: Host): Buffer {
  const w = new BufWriter();
  writeDuid(w, duid);
  writeHost(w, host);
  w.zeroes(8);
  return wrapMessage(PpppType.P2P_RDY_ACK, w.build());
}

export function pktHelloAck(host: Host): Buffer {
  const w = new BufWriter();
  writeHost(w, host);
  return wrapMessage(PpppType.HELLO_ACK, w.build());
}

export function pktDevLgnAckCrc(): Buffer {
  return wrapMessage(PpppType.DEV_LGN_ACK_CRC, cryptoCurseString(Buffer.alloc(4)));
}

export function pktDrw(chan: number, index: number, data: Buffer): Buffer {
  const body = new BufWriter().u8(0xd1).u8(chan).u16be(index).bytes(data).build();
  return wrapMessage(PpppType.DRW, body);
}

export function pktDrwAck(chan: number, acks: number[]): Buffer {
  const w = new BufWriter().u8(0xd1).u8(chan).u16be(acks.length);
  for (const a of acks) w.u16be(a);
  return wrapMessage(PpppType.DRW_ACK, w.build());
}

export { ZERO_HOST, AF_INET };

// ---------------------------------------------------------------------------
// XZYH frame (file-transfer command envelope)
// ---------------------------------------------------------------------------

export interface XzyhOptions {
  cmd: P2PCmdType;
  data: Buffer;
  chan?: number;
  signCode?: number;
  devType?: number;
}

export function packXzyh(opts: XzyhOptions): Buffer {
  const { cmd, data, chan = 0, signCode = 0, devType = 0 } = opts;
  return new BufWriter()
    .bytes(Buffer.from("XZYH", "ascii"))
    .u16le(cmd)
    .u32le(data.length)
    .u8(0) // unk0
    .u8(0) // unk1
    .u8(chan)
    .u8(signCode)
    .u8(0) // unk3
    .u8(devType)
    .bytes(data)
    .build();
}

// ---------------------------------------------------------------------------
// AABB frame (file-transfer data, CRC-protected)
// ---------------------------------------------------------------------------

export interface AabbHeader {
  frametype: FileTransfer;
  sn: number;
  pos: number;
  len: number;
}

const AABB_SIG = Buffer.from([0xaa, 0xbb]);

function packAabbHeader(h: AabbHeader): Buffer {
  return new BufWriter().bytes(AABB_SIG).u8(h.frametype).u8(h.sn).u32le(h.pos).u32le(h.len).build();
}

/** Build an AABB frame with trailing CRC16 over `header[2:] + data`. */
export function packAabb(
  frametype: FileTransfer,
  data: Buffer,
  opts: { sn?: number; pos?: number } = {},
): Buffer {
  const header = packAabbHeader({
    frametype,
    sn: opts.sn ?? 0,
    pos: opts.pos ?? 0,
    len: data.length,
  });
  const crc = ppcsCrc16(Buffer.concat([header.subarray(2), data]));
  return Buffer.concat([header, data, crc]);
}

export interface AabbParsed {
  header: AabbHeader;
  data: Buffer;
}

/** Parse an AABB frame (12-byte header + len bytes + 2-byte CRC), verifying CRC. */
export function parseAabbWithCrc(buf: Buffer): AabbParsed {
  const head = buf.subarray(0, 12);
  const r = new BufReader(head);
  r.magic(AABB_SIG);
  const frametype = r.u8() as FileTransfer;
  const sn = r.u8();
  const pos = r.u32le();
  const len = r.u32le();
  const data = buf.subarray(12, 12 + len);
  const crc1 = buf.subarray(12 + len, 12 + len + 2);
  const crc2 = ppcsCrc16(Buffer.concat([head.subarray(2), data]));
  if (!crc1.equals(crc2)) throw new Error("AABB CRC mismatch");
  return { header: { frametype, sn, pos, len }, data: Buffer.from(data) };
}

// ---------------------------------------------------------------------------
// FileUploadInfo (upload metadata string)
// ---------------------------------------------------------------------------

export interface FileUploadInfoFields {
  name: string;
  size: number;
  md5: string;
  userName: string;
  userId: string;
  machineId: string;
  type?: number;
}

/** Sanitize a filename to the upload whitelist (reference `sanitize_filename`). */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const cleaned = [...base].map((c) => (/[A-Za-z0-9._-]/.test(c) ? c : "_")).join("");
  return cleaned.replace(/^\.+/, "").replace(/\.\./g, ".");
}

/**
 * Serialize FileUploadInfo to its wire form:
 * `type,name,size,md5,user_name,user_id,machine_id` + a trailing NUL.
 */
export function packFileUploadInfo(f: FileUploadInfoFields): Buffer {
  const type = f.type ?? 0;
  const str = `${type},${f.name},${f.size},${f.md5},${f.userName},${f.userId},${f.machineId}`;
  return Buffer.concat([Buffer.from(str, "utf8"), Buffer.from([0])]);
}
