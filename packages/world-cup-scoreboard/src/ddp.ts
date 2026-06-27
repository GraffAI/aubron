/**
 * DDP (Distributed Display Protocol) sender for WLED realtime streaming.
 *
 * Header is 10 bytes; per-packet payload is capped at 1440 channels (480 RGB
 * LEDs). A 960-LED frame is therefore 2 packets, and **only the last packet
 * carries the PUSH flag** so WLED renders the whole frame atomically (no tear).
 * WLED reverts to its normal effects ~2.5s after the last packet, so keep
 * frames flowing while a scene is active.
 *
 * Refs: kno.wled.ge/interfaces/ddp, 3waylabs DDP spec, WLED udp.cpp/e131.cpp.
 */
import { createSocket, type Socket } from "node:dgram";

export const DDP_PORT = 4048;

const HEADER_LEN = 10;
const MAX_CHANNELS_PER_PACKET = 1440; // 480 RGB LEDs
const FLAG_VER1 = 0x40;
const FLAG_PUSH = 0x01;
const TYPE_RGB24 = 0x0b;
const ID_DISPLAY = 0x01;

export interface DdpOptions {
  host: string;
  port?: number;
}

/** Build the raw UDP datagrams for one frame of RGB bytes (3 bytes/LED). */
export function buildPackets(rgb: Uint8Array, seqStart = 0): Buffer[] {
  const packets: Buffer[] = [];
  const total = rgb.length;
  let offset = 0;
  let seq = seqStart & 0x0f;
  while (offset < total) {
    const len = Math.min(MAX_CHANNELS_PER_PACKET, total - offset);
    const last = offset + len >= total;
    const packet = Buffer.allocUnsafe(HEADER_LEN + len);
    packet[0] = FLAG_VER1 | (last ? FLAG_PUSH : 0);
    packet[1] = seq;
    packet[2] = TYPE_RGB24;
    packet[3] = ID_DISPLAY;
    packet.writeUInt32BE(offset, 4); // byte offset into the channel stream
    packet.writeUInt16BE(len, 8);
    Buffer.from(rgb.buffer, rgb.byteOffset + offset, len).copy(packet, HEADER_LEN);
    packets.push(packet);
    offset += len;
    seq = (seq + 1) & 0x0f;
  }
  return packets;
}

/** A fire-and-forget UDP sender holding one socket for the session. */
export class DdpSender {
  private readonly host: string;
  private readonly port: number;
  private socket: Socket | null = null;
  private seq = 0;

  constructor(opts: DdpOptions) {
    this.host = opts.host;
    this.port = opts.port ?? DDP_PORT;
  }

  private ensure(): Socket {
    if (!this.socket) this.socket = createSocket("udp4");
    return this.socket;
  }

  /** Send one frame. Resolves once all datagrams are handed to the OS. */
  async send(rgb: Uint8Array): Promise<void> {
    const socket = this.ensure();
    const packets = buildPackets(rgb, this.seq);
    this.seq = (this.seq + packets.length) & 0x0f;
    await Promise.all(
      packets.map(
        (p) =>
          new Promise<void>((resolve, reject) => {
            socket.send(p, this.port, this.host, (err) => (err ? reject(err) : resolve()));
          }),
      ),
    );
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }
}
