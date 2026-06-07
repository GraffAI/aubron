/**
 * PPPP LAN client (brief §5, §6A) — ported from the reference
 * `libflagship/ppppapi.py` + `cli/pppp.py` + the web file-transfer service.
 *
 * PPPP is LAN-only here (matching the reference): UDP broadcast discovery, a
 * punch/ready handshake, then reliable file upload over DRW channels. Upload is
 * `XZYH(P2P_SEND_FILE)` then `AABB` frames — BEGIN (metadata), DATA (chunks),
 * END (which starts the print). The SDK does no console I/O; progress and
 * diagnostics flow through callbacks.
 */
import { createSocket, type Socket } from "node:dgram";
import { md5Hex } from "../../crypto.js";
import { PrinterRejectedError, TimeoutError, TransportUnavailableError } from "../../errors.js";
import { Channel } from "./channel.js";
import {
  duidToString,
  FileTransfer,
  FileTransferReply,
  P2PCmdType,
  packAabb,
  packFileUploadInfo,
  packXzyh,
  parseAabbWithCrc,
  parseDuidString,
  parseMessage,
  pktAliveAck,
  pktClose,
  pktDevLgnAckCrc,
  pktDrwAck,
  pktHelloAck,
  pktLanSearch,
  pktP2pRdy,
  pktP2pRdyAck,
  PpppType,
  sanitizeFilename,
  type Duid,
  type Host,
} from "./packets.js";

export const PPPP_LAN_PORT = 32108;

export enum PpppState {
  Idle = 1,
  Connecting = 2,
  Connected = 3,
  Disconnected = 4,
}

export interface LanPrinter {
  duid: string;
  ip: string;
}

export interface UploadProgress {
  sent: number;
  total: number;
  pct: number;
}

export interface PpppClientOptions {
  duid: string;
  host: string;
  port?: number;
  log?: (msg: string) => void;
}

/**
 * One-shot LAN discovery: broadcast a `LAN_SEARCH` and collect `PUNCH_PKT`
 * replies (each yields a DUID + source IP). Retried by the caller — UDP
 * broadcast is flaky (the §4 lesson).
 */
export function discoverLan(
  opts: { timeoutMs?: number; bindAddr?: string; log?: (m: string) => void } = {},
): Promise<LanPrinter[]> {
  const { timeoutMs = 1000, bindAddr, log = () => {} } = opts;
  return new Promise((resolve, reject) => {
    const sock = createSocket({ type: "udp4", reuseAddr: true });
    const found = new Map<string, string>();

    const done = (): void => {
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      resolve([...found].map(([duid, ip]) => ({ duid, ip })));
    };

    sock.on("error", (err) => {
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      reject(err);
    });

    sock.on("message", (data, rinfo) => {
      try {
        const msg = parseMessage(data);
        if (msg.type === PpppType.PUNCH_PKT && msg.duid) {
          found.set(duidToString(msg.duid), rinfo.address);
        }
      } catch {
        /* ignore malformed datagrams */
      }
    });

    sock.bind(bindAddr ? { address: bindAddr, port: 0 } : { port: 0 }, () => {
      sock.setBroadcast(true);
      log(`pppp: broadcasting LAN_SEARCH (timeout ${timeoutMs}ms)`);
      sock.send(pktLanSearch(), PPPP_LAN_PORT, "255.255.255.255");
      setTimeout(done, timeoutMs);
    });
  });
}

export class AnkerPpppClient {
  private sock?: Socket;
  private addr: { host: string; port: number };
  private readonly duid: Duid;
  private readonly chans: Channel[] = Array.from({ length: 8 }, (_, i) => new Channel(i));
  private pollTimer?: ReturnType<typeof setInterval>;
  private readonly log: (msg: string) => void;
  state: PpppState = PpppState.Idle;
  private connectResolve?: () => void;
  private connectReject?: (err: Error) => void;

  constructor(opts: PpppClientOptions) {
    this.duid = parseDuidString(opts.duid);
    this.addr = { host: opts.host, port: opts.port ?? PPPP_LAN_PORT };
    this.log = opts.log ?? (() => {});
  }

  private get host(): Host {
    return { afam: 2, port: this.addr.port, addr: this.addr.host };
  }

  private send(buf: Buffer): void {
    this.sock?.send(buf, this.addr.port, this.addr.host);
  }

  /** Connect over the LAN via the punch/ready handshake. */
  connect(timeoutMs = 10000): Promise<void> {
    this.sock = createSocket("udp4");
    this.sock.on("message", (data, rinfo) => {
      this.addr = { host: rinfo.address, port: rinfo.port };
      this.process(data);
    });
    this.sock.on("error", (err) => this.failConnect(err));
    this.state = PpppState.Connecting;

    const ready = new Promise<void>((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });

    this.send(pktLanSearch());
    this.pollTimer = setInterval(() => this.pollChannels(), 20);

    const timer = setTimeout(() => {
      if (this.state !== PpppState.Connected) {
        this.failConnect(
          new TimeoutError({
            message: `PPPP handshake to ${this.addr.host} timed out`,
            transport: "pppp",
            hint: "The printer may be off-LAN or asleep. Re-run `ankerts discover --store` and retry.",
          }),
        );
      }
    }, timeoutMs);

    return ready.finally(() => clearTimeout(timer));
  }

  private failConnect(err: Error): void {
    this.state = PpppState.Disconnected;
    this.stop();
    this.connectReject?.(err);
    this.connectReject = undefined;
    this.connectResolve = undefined;
  }

  private pollChannels(): void {
    const now = Date.now();
    for (const ch of this.chans) {
      for (const pkt of ch.poll(now)) this.send(pkt);
    }
  }

  private process(data: Buffer): void {
    let msg;
    try {
      msg = parseMessage(data);
    } catch {
      return;
    }
    switch (msg.type) {
      case PpppType.CLOSE:
        this.failConnect(new Error("PPPP connection closed by device"));
        break;
      case PpppType.ALIVE:
        this.send(pktAliveAck());
        break;
      case PpppType.DRW:
        if (msg.chan !== undefined && msg.index !== undefined && msg.data) {
          this.send(pktDrwAck(msg.chan, [msg.index]));
          this.chans[msg.chan]?.rxDrw(msg.index, msg.data);
        }
        break;
      case PpppType.DRW_ACK:
        if (msg.chan !== undefined && msg.acks) this.chans[msg.chan]?.rxAck(msg.acks);
        break;
      case PpppType.DEV_LGN_CRC:
        this.send(pktDevLgnAckCrc());
        break;
      case PpppType.HELLO:
        this.send(pktHelloAck(this.host));
        break;
      case PpppType.P2P_RDY:
        this.send(pktP2pRdyAck(this.duid, this.host));
        this.state = PpppState.Connected;
        this.connectResolve?.();
        this.connectResolve = undefined;
        this.connectReject = undefined;
        this.log("pppp: connected");
        break;
      case PpppType.PUNCH_PKT:
        if (this.state === PpppState.Connecting) {
          this.send(pktClose());
          this.send(pktP2pRdy(this.duid));
        }
        break;
      default:
        break;
    }
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    if (this.sock) {
      try {
        if (this.state === PpppState.Connected) this.send(pktClose());
        this.sock.close();
      } catch {
        /* ignore */
      }
      this.sock = undefined;
    }
  }

  /** Send one channel-1 AABB request and await the printer's reply byte. */
  private async aabbRequest(
    frametype: FileTransfer,
    data: Buffer,
    opts: { pos?: number; replyTimeoutMs?: number } = {},
  ): Promise<FileTransferReply> {
    const ch = this.chans[1]!;
    const { done } = ch.write(packAabb(frametype, data, { pos: opts.pos ?? 0 }));
    await ch.ackUpTo(done);

    const replyTimeout = opts.replyTimeoutMs ?? 30000;
    const head = await ch.read(12, replyTimeout);
    const len = head.readUInt32LE(8);
    const rest = await ch.read(len + 2, replyTimeout);
    const { data: payload } = parseAabbWithCrc(Buffer.concat([head, rest]));
    const reply = (payload[0] ?? FileTransferReply.ERR_BUSY) as FileTransferReply;
    if (reply !== FileTransferReply.OK) {
      throw new PrinterRejectedError({
        code: "upload_rejected",
        message: `Printer rejected file transfer: ${FileTransferReply[reply] ?? reply}`,
        transport: "pppp",
      });
    }
    return reply;
  }

  /**
   * Upload a gcode file and (by default) start the print. Mirrors the reference
   * web service: XZYH(P2P_SEND_FILE) → AABB BEGIN (metadata) → AABB DATA chunks
   * → AABB END (starts printing).
   */
  async uploadFile(
    filename: string,
    data: Buffer,
    opts: {
      userName?: string;
      userId?: string;
      machineId?: string;
      start?: boolean;
      onProgress?: (p: UploadProgress) => void;
    } = {},
  ): Promise<{ name: string; size: number; md5: string; started: boolean }> {
    if (this.state !== PpppState.Connected) {
      throw new TransportUnavailableError({
        message: "PPPP not connected — cannot upload",
        transport: "pppp",
        hint: "Run discovery and connect to the printer on the LAN first.",
      });
    }
    const name = sanitizeFilename(filename);
    const md5 = md5Hex(data);
    const fui = packFileUploadInfo({
      name,
      size: data.length,
      md5,
      userName: opts.userName ?? "ankerts",
      userId: opts.userId ?? "-",
      machineId: opts.machineId ?? "-",
    });

    // 1. request file transfer (16-byte token on channel 0).
    const token = Buffer.from(
      globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16),
      "utf8",
    );
    const ch0 = this.chans[0]!;
    const { done: tokenDone } = ch0.write(packXzyh({ cmd: P2PCmdType.P2P_SEND_FILE, data: token }));
    await ch0.ackUpTo(tokenDone);

    // 2. metadata (BEGIN). The reference appends an extra NUL after the struct.
    this.log(`pppp: uploading ${data.length} bytes as ${name}`);
    await this.aabbRequest(FileTransfer.BEGIN, Buffer.concat([fui, Buffer.from([0])]));

    // 3. file contents in 32KB chunks.
    const blockSize = 1024 * 32;
    let sent = 0;
    for (let pos = 0; pos < data.length; pos += blockSize) {
      const chunk = data.subarray(pos, pos + blockSize);
      await this.aabbRequest(FileTransfer.DATA, chunk, { pos });
      sent += chunk.length;
      opts.onProgress?.({ sent, total: data.length, pct: (sent / data.length) * 100 });
    }

    // 4. END starts the print (unless start === false → abort/leave staged).
    const started = opts.start !== false;
    if (started) {
      await this.aabbRequest(FileTransfer.END, Buffer.alloc(0));
    }

    return { name, size: data.length, md5, started };
  }
}
