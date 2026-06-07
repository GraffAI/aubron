import { describe, expect, it } from "vitest";
import {
  aesCbcDecrypt,
  aesCbcEncrypt,
  b64d,
  cryptoCurseString,
  cryptoDecurseString,
  ecdhEncryptLoginPassword,
  enhex,
  md5Hex,
  mqttAesDecrypt,
  mqttAesEncrypt,
  mqttChecksumAdd,
  mqttChecksumRemove,
  ppcsCrc16,
  simpleDecrypt,
  simpleEncrypt,
  unhex,
  xorBytes,
} from "./crypto.js";

describe("aes-cbc", () => {
  const key = unhex("000102030405060708090a0b0c0d0e0f");
  const iv = Buffer.from("3DPrintAnkerMake", "ascii");

  it("round-trips an arbitrary message with PKCS#7 padding", () => {
    const msg = Buffer.from("the quick brown fox", "utf8");
    const enc = aesCbcEncrypt(msg, key, iv);
    expect(enc.length % 16).toBe(0);
    expect(aesCbcDecrypt(enc, key, iv).equals(msg)).toBe(true);
  });

  it("mqtt helpers default to the firmware IV", () => {
    const msg = Buffer.from('{"commandType":1043}', "utf8");
    expect(mqttAesDecrypt(mqttAesEncrypt(msg, key), key).equals(msg)).toBe(true);
  });

  it("supports aes-256 keys (ECDH login path)", () => {
    const key32 = unhex("00".repeat(32));
    const msg = Buffer.from("hunter2", "utf8");
    expect(aesCbcDecrypt(aesCbcEncrypt(msg, key32, iv), key32, iv).equals(msg)).toBe(true);
  });
});

describe("xor checksum", () => {
  it("a well-formed packet XORs to zero and round-trips", () => {
    const msg = Buffer.from([0x4d, 0x41, 0x10, 0x00, 0xff]);
    const withSum = mqttChecksumAdd(msg);
    expect(xorBytes(withSum)).toBe(0);
    expect(mqttChecksumRemove(withSum).equals(msg)).toBe(true);
  });

  it("rejects a corrupted packet", () => {
    const bad = Buffer.from([0x01, 0x02, 0x03, 0x99]);
    expect(() => mqttChecksumRemove(bad)).toThrow(/checksum/);
  });
});

describe("ppcsCrc16 (CRC-16/XMODEM — poly 0x1021, init 0x0000)", () => {
  it("matches the canonical check value for '123456789'", () => {
    // The reference uses initCrc=0x0000 (XMODEM), whose check value is 0x31C3,
    // packed little-endian by struct.pack("<H", ...).
    expect(enhex(ppcsCrc16(Buffer.from("123456789", "ascii")))).toBe("c331");
  });
});

describe("md5Hex", () => {
  it("hashes the empty string", () => {
    expect(md5Hex(Buffer.alloc(0))).toBe("d41d8cd98f00b204e9800998ecf8427e");
  });
});

describe("pppp curse cipher", () => {
  it("round-trips through curse/decurse with the CCCC trailer", () => {
    const data = Buffer.from("USPRAKM-000994-YYLLG", "ascii");
    expect(cryptoDecurseString(cryptoCurseString(data)).equals(data)).toBe(true);
  });
});

describe("pppp simple cipher", () => {
  it("round-trips through encrypt/decrypt", () => {
    const data = Buffer.from("foobar payload \x00\x01\x02", "binary");
    expect(simpleDecrypt(simpleEncrypt(data)).equals(data)).toBe(true);
  });
});

describe("ecdhEncryptLoginPassword", () => {
  it("produces an uncompressed pubkey and base64 ciphertext", () => {
    const { publicKey, encryptedPassword } = ecdhEncryptLoginPassword("s3cret");
    expect(publicKey).toMatch(/^04[0-9a-f]{128}$/);
    // base64 of an AES-CBC block (>= 16 bytes)
    expect(b64d(encryptedPassword).length % 16).toBe(0);
    expect(b64d(encryptedPassword).length).toBeGreaterThanOrEqual(16);
  });
});
