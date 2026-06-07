/**
 * Low-level cryptography, ported faithfully from the AnkerMake reference
 * implementation (`libflagship/megajank.py`). None of this is our design — it
 * is the obfuscation/encryption the M5 firmware speaks, reproduced byte-for-byte
 * so the SDK can interoperate. See the project brief §5.
 *
 * Pure functions over Buffers; no I/O, no console.
 */
import { createCipheriv, createDecipheriv, createECDH, createHash, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// hex / base64 helpers (libflagship/util.py)
// ---------------------------------------------------------------------------

export const unhex = (s: string): Buffer => Buffer.from(s, "hex");
export const enhex = (b: Buffer): string => b.toString("hex");
export const b64e = (b: Buffer): string => b.toString("base64");
export const b64d = (s: string): Buffer => Buffer.from(s, "base64");

// ---------------------------------------------------------------------------
// MQTT AES-CBC + XOR checksum (megajank.py: mqtt aes / checksum handling)
// ---------------------------------------------------------------------------

/** Default IV used by the firmware for MQTT payloads: ASCII "3DPrintAnkerMake". */
export const MQTT_AES_IV = Buffer.from("3DPrintAnkerMake", "ascii");

/** PKCS#7 pad to a 16-byte boundary (always adds 1..16 bytes). */
function pkcs7Pad(data: Buffer, blockSize = 16): Buffer {
  const padLen = blockSize - (data.length % blockSize);
  return Buffer.concat([data, Buffer.alloc(padLen, padLen)]);
}

function pkcs7Unpad(data: Buffer): Buffer {
  if (data.length === 0) return data;
  const padLen = data[data.length - 1]!;
  if (padLen < 1 || padLen > 16 || padLen > data.length) {
    throw new Error("invalid PKCS#7 padding");
  }
  return data.subarray(0, data.length - padLen);
}

/** Map a raw key length to the matching AES-CBC algorithm name. */
function aesCbcAlgo(key: Buffer): string {
  switch (key.length) {
    case 16:
      return "aes-128-cbc";
    case 24:
      return "aes-192-cbc";
    case 32:
      return "aes-256-cbc";
    default:
      throw new Error(`unsupported AES key length: ${key.length} bytes`);
  }
}

export function aesCbcEncrypt(msg: Buffer, key: Buffer, iv: Buffer): Buffer {
  const cipher = createCipheriv(aesCbcAlgo(key), key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(pkcs7Pad(msg)), cipher.final()]);
}

export function aesCbcDecrypt(cmsg: Buffer, key: Buffer, iv: Buffer): Buffer {
  const decipher = createDecipheriv(aesCbcAlgo(key), key, iv);
  decipher.setAutoPadding(false);
  return pkcs7Unpad(Buffer.concat([decipher.update(cmsg), decipher.final()]));
}

export const mqttAesEncrypt = (msg: Buffer, key: Buffer, iv: Buffer = MQTT_AES_IV): Buffer =>
  aesCbcEncrypt(msg, key, iv);

export const mqttAesDecrypt = (cmsg: Buffer, key: Buffer, iv: Buffer = MQTT_AES_IV): Buffer =>
  aesCbcDecrypt(cmsg, key, iv);

/** XOR of every byte. The firmware appends this as a trailing checksum byte. */
export function xorBytes(data: Buffer): number {
  let s = 0;
  for (const x of data) s ^= x;
  return s;
}

export function mqttChecksumAdd(msg: Buffer): Buffer {
  return Buffer.concat([msg, Buffer.from([xorBytes(msg)])]);
}

/**
 * Verify and strip the trailing XOR checksum. A well-formed packet XORs to 0
 * across its whole length (payload + checksum byte).
 */
export function mqttChecksumRemove(payload: Buffer): Buffer {
  if (xorBytes(payload) !== 0) {
    throw new Error("malformed MQTT message: checksum mismatch");
  }
  return payload.subarray(0, payload.length - 1);
}

// ---------------------------------------------------------------------------
// ECDH login-password encryption (megajank.py: ecdh_encrypt_login_password)
// ---------------------------------------------------------------------------

/**
 * Anker's fixed server public key (secp256r1 / prime256v1), uncompressed form
 * 0x04 || X || Y. Used as the ECDH partner when encrypting the login password.
 */
const ANKER_EC_PUBKEY = Buffer.from(
  "04" +
    "c5c00c4f8d1197cc7c3167c52bf7acb054d722f0ef08dcd7e0883236e0d72a38" +
    "68d9750cb47fa4619248f3d83f0f662671dadc6e2d31c2f41db0161651c7c076",
  "hex",
);

/**
 * Encrypt a login password the way the passport API expects.
 *
 * Returns the freshly generated ephemeral public key (hex, uncompressed) and
 * the base64 AES-CBC ciphertext. The AES key is the X coordinate of the ECDH
 * shared secret; the IV is the first half of that key.
 */
export function ecdhEncryptLoginPassword(password: string): {
  publicKey: string;
  encryptedPassword: string;
} {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  // computeSecret() returns the shared point's X coordinate (32 bytes).
  const key = ecdh.computeSecret(ANKER_EC_PUBKEY);
  const iv = key.subarray(0, 16);
  const ciphertext = aesCbcEncrypt(Buffer.from(password, "utf8"), key, iv);
  return {
    publicKey: ecdh.getPublicKey("hex", "uncompressed"),
    encryptedPassword: b64e(ciphertext),
  };
}

// ---------------------------------------------------------------------------
// login cache key (logincache.py) — legacy AES-ECB decrypt of slicer login.json
// ---------------------------------------------------------------------------

const LOGIN_CACHE_KEY = unhex("1b55f97793d58864571e1055838cac97");

/** Decrypt the legacy slicer `login.json` blob (AES-ECB, NUL-trimmed). */
export function decryptLoginCache(data: string, key: Buffer = LOGIN_CACHE_KEY): string {
  const raw = b64d(data);
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  decipher.setAutoPadding(false);
  const out = Buffer.concat([decipher.update(raw), decipher.final()]);
  // strip trailing NULs
  let end = out.length;
  while (end > 0 && out[end - 1] === 0) end--;
  return out.subarray(0, end).toString("utf8");
}

// ---------------------------------------------------------------------------
// MD5 (FileUploadInfo) + CRC16 (PPCS framing)
// ---------------------------------------------------------------------------

export const md5Hex = (data: Buffer): string => createHash("md5").update(data).digest("hex");

/**
 * CRC-16/CCITT-FALSE (poly 0x1021, init 0x0000, no reflection, xorout 0),
 * returned little-endian as a 2-byte Buffer — matching the reference's
 * `ppcs_crc16` (`crcmod.mkCrcFun(0x11021, rev=False, initCrc=0x0000)` +
 * `struct.pack("<H", ...)`).
 */
export function ppcsCrc16(data: Buffer): Buffer {
  let crc = 0x0000;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  const out = Buffer.alloc(2);
  out.writeUInt16LE(crc, 0);
  return out;
}

export const randomGuidBytes = (n: number): Buffer => randomBytes(n);

// ---------------------------------------------------------------------------
// PPPP "curse" obfuscation (megajank.py: crypto_curse / crypto_decurse)
// ---------------------------------------------------------------------------

const PPPP_SEED = "EUPRAKM";

const PPPP_SHUFFLE: number[][] = [
  [0x95, 0xe5, 0x61, 0x97, 0x83, 0x0d, 0xa7, 0xf1],
  [0xd3, 0x05, 0x95, 0x8b, 0xdf, 0x13, 0x6d, 0xef],
  [0x07, 0x61, 0x0d, 0x6d, 0x7f, 0x67, 0x17, 0x2b],
  [0xc1, 0xb5, 0x13, 0x0b, 0xdf, 0x8b, 0x49, 0x3b],
  [0x7f, 0x07, 0xd3, 0x02, 0x6d, 0x2f, 0x13, 0xc5],
  [0x6d, 0x3d, 0xfb, 0x0d, 0x0b, 0x29, 0xe9, 0x4f],
  [0x89, 0x2f, 0xe3, 0xe9, 0x0d, 0x83, 0x6d, 0xe5],
  [0x07, 0x53, 0x8b, 0x25, 0x95, 0x47, 0x1f, 0x29],
];

/** Advance the (a,b,c,d) state by one byte `q`, per the reference. */
function curseStep(
  a: number,
  b: number,
  c: number,
  d: number,
  q: number,
  shuffle: number[][],
): [number, number, number, number] {
  return [
    shuffle[(b + (q % a)) & 7]![(q + (c % d)) & 7]!,
    shuffle[(c + (q % b)) & 7]![(q + (d % a)) & 7]!,
    shuffle[(d + (q % c)) & 7]![(q + (a % b)) & 7]!,
    shuffle[(a + (q % d)) & 7]![(q + (b % c)) & 7]!,
  ];
}

function curseInit(key: string, shuffle: number[][]): [number, number, number, number] {
  let [a, b, c, d] = [1, 3, 5, 7];
  for (const ch of key) {
    [a, b, c, d] = curseStep(a, b, c, d, ch.charCodeAt(0), shuffle);
  }
  return [a, b, c, d];
}

function cryptoDecurse(input: Buffer, key: string, shuffle: number[][]): number[] {
  let [a, b, c, d] = curseInit(key, shuffle);
  const output: number[] = new Array(input.length).fill(0);
  for (let p = 0; p < input.length; p++) {
    const x = input[p]!;
    output[p] = x ^ (a ^ b ^ c ^ d);
    [a, b, c, d] = curseStep(a, b, c, d, x, shuffle);
  }
  return output;
}

function cryptoCurse(input: Buffer, key: string, shuffle: number[][]): number[] {
  let [a, b, c, d] = curseInit(key, shuffle);
  const output: number[] = new Array(input.length + 4).fill(0);
  for (let p = 0; p < input.length; p++) {
    const x = (output[p] = input[p]! ^ (a ^ b ^ c ^ d));
    [a, b, c, d] = curseStep(a, b, c, d, x, shuffle);
  }
  for (let p = input.length; p < input.length + 4; p++) {
    const x = (output[p] = a ^ b ^ c ^ d ^ 0x43);
    [a, b, c, d] = curseStep(a, b, c, d, x, shuffle);
  }
  return output;
}

export function cryptoCurseString(input: Buffer): Buffer {
  return Buffer.from(cryptoCurse(input, PPPP_SEED, PPPP_SHUFFLE));
}

export function cryptoDecurseString(input: Buffer): Buffer {
  const output = cryptoDecurse(input, PPPP_SEED, PPPP_SHUFFLE);
  const tail = output.slice(-4);
  if (tail[0] !== 0x43 || tail[1] !== 0x43 || tail[2] !== 0x43 || tail[3] !== 0x43) {
    throw new Error("invalid PPPP decurse (missing trailer)");
  }
  return Buffer.from(output.slice(0, -4));
}

// ---------------------------------------------------------------------------
// PPPP "simple" cipher (megajank.py: simple_encrypt / simple_decrypt)
// adapted from https://github.com/fbertone/lib32100/issues/7
// ---------------------------------------------------------------------------

const PPPP_SIMPLE_SEED = Buffer.from("SSD@cs2-network.", "ascii");

// prettier-ignore
const PPPP_SIMPLE_SHUFFLE: number[] = [
  0x7C, 0x9C, 0xE8, 0x4A, 0x13, 0xDE, 0xDC, 0xB2, 0x2F, 0x21, 0x23, 0xE4, 0x30, 0x7B, 0x3D, 0x8C,
  0xBC, 0x0B, 0x27, 0x0C, 0x3C, 0xF7, 0x9A, 0xE7, 0x08, 0x71, 0x96, 0x00, 0x97, 0x85, 0xEF, 0xC1,
  0x1F, 0xC4, 0xDB, 0xA1, 0xC2, 0xEB, 0xD9, 0x01, 0xFA, 0xBA, 0x3B, 0x05, 0xB8, 0x15, 0x87, 0x83,
  0x28, 0x72, 0xD1, 0x8B, 0x5A, 0xD6, 0xDA, 0x93, 0x58, 0xFE, 0xAA, 0xCC, 0x6E, 0x1B, 0xF0, 0xA3,
  0x88, 0xAB, 0x43, 0xC0, 0x0D, 0xB5, 0x45, 0x38, 0x4F, 0x50, 0x22, 0x66, 0x20, 0x7F, 0x07, 0x5B,
  0x14, 0x98, 0x1D, 0x9B, 0xA7, 0x2A, 0xB9, 0xA8, 0xCB, 0xF1, 0xFC, 0x49, 0x47, 0x06, 0x3E, 0xB1,
  0x0E, 0x04, 0x3A, 0x94, 0x5E, 0xEE, 0x54, 0x11, 0x34, 0xDD, 0x4D, 0xF9, 0xEC, 0xC7, 0xC9, 0xE3,
  0x78, 0x1A, 0x6F, 0x70, 0x6B, 0xA4, 0xBD, 0xA9, 0x5D, 0xD5, 0xF8, 0xE5, 0xBB, 0x26, 0xAF, 0x42,
  0x37, 0xD8, 0xE1, 0x02, 0x0A, 0xAE, 0x5F, 0x1C, 0xC5, 0x73, 0x09, 0x4E, 0x69, 0x24, 0x90, 0x6D,
  0x12, 0xB3, 0x19, 0xAD, 0x74, 0x8A, 0x29, 0x40, 0xF5, 0x2D, 0xBE, 0xA5, 0x59, 0xE0, 0xF4, 0x79,
  0xD2, 0x4B, 0xCE, 0x89, 0x82, 0x48, 0x84, 0x25, 0xC6, 0x91, 0x2B, 0xA2, 0xFB, 0x8F, 0xE9, 0xA6,
  0xB0, 0x9E, 0x3F, 0x65, 0xF6, 0x03, 0x31, 0x2E, 0xAC, 0x0F, 0x95, 0x2C, 0x5C, 0xED, 0x39, 0xB7,
  0x33, 0x6C, 0x56, 0x7E, 0xB4, 0xA0, 0xFD, 0x7A, 0x81, 0x53, 0x51, 0x86, 0x8D, 0x9F, 0x77, 0xFF,
  0x6A, 0x80, 0xDF, 0xE2, 0xBF, 0x10, 0xD7, 0x75, 0x64, 0x57, 0x76, 0xF3, 0x55, 0xCD, 0xD0, 0xC8,
  0x18, 0xE6, 0x36, 0x41, 0x62, 0xCF, 0x99, 0xF2, 0x32, 0x4C, 0x67, 0x60, 0x61, 0x92, 0xCA, 0xD3,
  0xEA, 0x63, 0x7D, 0x16, 0xB6, 0x8E, 0xD4, 0x68, 0x35, 0xC3, 0x52, 0x9D, 0x46, 0x44, 0x1E, 0x17,
];

function simpleHash(seed: Buffer): number[] {
  const hash = [0, 0, 0, 0];
  for (const byte of seed) {
    hash[0] = (hash[0]! ^ byte) & 0xff;
    hash[1] = (hash[1]! + Math.floor(byte / 3)) & 0xff;
    hash[2] = (hash[2]! - byte) & 0xff;
    hash[3] = (hash[3]! + byte) & 0xff;
  }
  return hash.reverse();
}

function simpleLookup(hash: number[], b: number): number {
  const index = (hash[b & 0x3]! + b) & 0xffffffff;
  return PPPP_SIMPLE_SHUFFLE[
    ((index % PPPP_SIMPLE_SHUFFLE.length) + PPPP_SIMPLE_SHUFFLE.length) % PPPP_SIMPLE_SHUFFLE.length
  ]!;
}

export function simpleDecrypt(input: Buffer, seed: Buffer = PPPP_SIMPLE_SEED): Buffer {
  const hash = simpleHash(seed);
  const output = Buffer.alloc(input.length);
  if (input.length === 0) return output;
  output[0] = input[0]! ^ simpleLookup(hash, 0);
  for (let i = 1; i < input.length; i++) {
    output[i] = input[i]! ^ simpleLookup(hash, input[i - 1]!);
  }
  return output;
}

export function simpleEncrypt(input: Buffer, seed: Buffer = PPPP_SIMPLE_SEED): Buffer {
  const hash = simpleHash(seed);
  const output = Buffer.alloc(input.length);
  if (input.length === 0) return output;
  output[0] = input[0]! ^ simpleLookup(hash, 0);
  for (let i = 1; i < input.length; i++) {
    output[i] = input[i]! ^ simpleLookup(hash, output[i - 1]!);
  }
  return output;
}

// ---------------------------------------------------------------------------
// PPPP init-string decoder (megajank.py: pppp_decode_initstring)
// Decodes the `app_conn` / `p2p_conn` host lists from the cloud printer record.
// ---------------------------------------------------------------------------

// prettier-ignore
const PPPP_INITSTRING_SHUFFLE: number[] = [
  0x49, 0x59, 0x43, 0x3d, 0xb5, 0xbf, 0x6d, 0xa3, 0x47, 0x53,
  0x4f, 0x61, 0x65, 0xe3, 0x71, 0xe9, 0x67, 0x7f, 0x02, 0x03,
  0x0b, 0xad, 0xb3, 0x89, 0x2b, 0x2f, 0x35, 0xc1, 0x6b, 0x8b,
  0x95, 0x97, 0x11, 0xe5, 0xa7, 0x0d, 0xef, 0xf1, 0x05, 0x07,
  0x83, 0xfb, 0x9d, 0x3b, 0xc5, 0xc7, 0x13, 0x17, 0x1d, 0x1f,
  0x25, 0x29, 0xd3, 0xdf,
];

function ppppDecodeInitstringRaw(input: Buffer): Buffer {
  const olen = input.length >> 1;
  const output: number[] = new Array(olen).fill(0);
  for (let q = 0; q < olen; q++) {
    let xor = 0x39 ^ PPPP_INITSTRING_SHUFFLE[q % 0x36]!;
    for (let p = 0; p <= q; p++) xor ^= output[p]!;
    const l = input[q * 2 + 1]! - 0x41;
    const h = input[q * 2 + 0]! - 0x41;
    output[q] = (xor ^ (l + (h << 4))) & 0xff;
  }
  return Buffer.from(output);
}

/** Decode a PPPP init string into its comma-separated host list. */
export function ppppDecodeInitstring(input: string): string[] {
  const res = ppppDecodeInitstringRaw(Buffer.from(input, "ascii"));
  return res.toString("utf8").replace(/,+$/, "").split(",");
}
