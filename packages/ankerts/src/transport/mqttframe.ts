/**
 * MQTT message framing, ported from the reference `libflagship/mqtt.py`.
 *
 * Each MQTT message is an `MA`-signed header followed by an AES-CBC-encrypted
 * JSON payload and a trailing XOR checksum byte. The header carries a packet
 * type (Single / MultiBegin / MultiAppend / MultiFinish), a per-printer device
 * GUID, and a timestamp. In practice each MQTT message carries one complete JSON
 * object (the multi-frame gcode reply story of §6 is at the application layer:
 * several *separate* reply messages, not header fragmentation).
 *
 * Pure framing — pack/parse round-trips are unit-tested without a broker.
 */
import { BufReader, BufWriter } from "../binary.js";
import { mqttAesDecrypt, mqttAesEncrypt, mqttChecksumAdd, mqttChecksumRemove } from "../crypto.js";

export enum MqttPktType {
  Single = 0xc0,
  MultiBegin = 0xc1,
  MultiAppend = 0xc2,
  MultiFinish = 0xc3,
}

const SIGNATURE = Buffer.from("MA", "ascii");
const M7_F = 0x46; // 'F'

// Header length by `m5` magic: 2 = AnkerMake M5 (64), 1 = M5C (24).
const BODY_LEN: Record<number, number> = { 1: 24, 2: 64 };

export interface MqttMessage {
  packetType: MqttPktType;
  packetNum: number;
  time: number;
  deviceGuid: string;
  /** Decoded JSON payload (object). */
  payload: unknown;
}

export interface PackOptions {
  guid: string;
  payload: unknown;
  key: Buffer;
  packetType?: MqttPktType;
  packetNum?: number;
  time?: number;
}

/** Build a wire-ready, encrypted+checksummed MQTT packet for an M5. */
export function packMqttMessage(opts: PackOptions): Buffer {
  const data = mqttAesEncrypt(Buffer.from(JSON.stringify(opts.payload), "utf8"), opts.key);
  const bodyLen = 64;
  const size = bodyLen + data.length + 1; // +1 for the checksum byte

  const header = new BufWriter()
    .bytes(SIGNATURE)
    .u16le(size)
    .u8(5) // m3
    .u8(1) // m4
    .u8(2) // m5 (M5)
    .u8(5) // m6
    .u8(M7_F) // m7 = 'F'
    .u8(opts.packetType ?? MqttPktType.Single)
    .u16le(opts.packetNum ?? 0)
    .u32le(opts.time ?? 0)
    .string(opts.guid, 37)
    .zeroes(11)
    .build();

  // header is exactly 64 bytes by construction.
  return mqttChecksumAdd(Buffer.concat([header.subarray(0, bodyLen), data]));
}

/** Parse and decrypt an inbound MQTT packet. */
export function parseMqttMessage(payload: Buffer, key: Buffer): MqttMessage {
  const stripped = mqttChecksumRemove(payload);
  const m5 = stripped[6];
  const bodyLen = m5 !== undefined ? BODY_LEN[m5] : undefined;
  if (bodyLen === undefined) {
    throw new Error(`unsupported MQTT message format (m5=${m5})`);
  }
  const body = stripped.subarray(0, bodyLen);
  const data = mqttAesDecrypt(stripped.subarray(bodyLen), key);

  const r = new BufReader(body);
  r.magic(SIGNATURE);
  r.u16le(); // size
  r.u8(); // m3
  r.u8(); // m4
  r.u8(); // m5
  r.u8(); // m6
  r.u8(); // m7
  const packetType = r.u8() as MqttPktType;
  const packetNum = r.u16le();
  let time = 0;
  let deviceGuid = "none";
  if (m5 === 2) {
    time = r.u32le();
    deviceGuid = r.string(37);
  }
  // remaining header bytes are padding (ignored)

  return { packetType, packetNum, time, deviceGuid, payload: JSON.parse(data.toString("utf8")) };
}
