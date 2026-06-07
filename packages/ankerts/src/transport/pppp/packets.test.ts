import { describe, expect, it } from "vitest";
import {
  duidToString,
  FileTransfer,
  packAabb,
  packFileUploadInfo,
  parseAabbWithCrc,
  parseDuidString,
  parseMessage,
  pktDrw,
  pktDrwAck,
  pktLanSearch,
  PpppType,
  sanitizeFilename,
} from "./packets.js";

describe("Duid", () => {
  it("round-trips the string form", () => {
    const d = parseDuidString("USPRAKM-000994-YYLLG");
    expect(d.prefix).toBe("USPRAKM");
    expect(d.serial).toBe(994);
    expect(d.check).toBe("YYLLG");
    expect(duidToString(d)).toBe("USPRAKM-000994-YYLLG");
  });
});

describe("Message framing", () => {
  it("encodes LAN_SEARCH as F1 30 0000", () => {
    expect([...pktLanSearch()]).toEqual([0xf1, 0x30, 0x00, 0x00]);
  });

  it("round-trips a DRW packet", () => {
    const payload = Buffer.from("XZYHpayload", "ascii");
    const msg = parseMessage(pktDrw(1, 0x1234, payload));
    expect(msg.type).toBe(PpppType.DRW);
    expect(msg.chan).toBe(1);
    expect(msg.index).toBe(0x1234);
    expect(msg.data?.equals(payload)).toBe(true);
  });

  it("round-trips a DRW_ACK with multiple acks", () => {
    const msg = parseMessage(pktDrwAck(1, [1, 2, 65535]));
    expect(msg.type).toBe(PpppType.DRW_ACK);
    expect(msg.chan).toBe(1);
    expect(msg.acks).toEqual([1, 2, 65535]);
  });
});

describe("AABB frame", () => {
  it("packs and parses with a verified CRC", () => {
    const data = Buffer.from("0,tower.gcode,123,abc,user,-,-\x00", "utf8");
    const frame = packAabb(FileTransfer.BEGIN, data);
    const parsed = parseAabbWithCrc(frame);
    expect(parsed.header.frametype).toBe(FileTransfer.BEGIN);
    expect(parsed.header.len).toBe(data.length);
    expect(parsed.data.equals(data)).toBe(true);
  });

  it("throws on CRC corruption", () => {
    const frame = packAabb(FileTransfer.DATA, Buffer.from("hello"), { pos: 4096 });
    frame[13] = frame[13]! ^ 0xff;
    expect(() => parseAabbWithCrc(frame)).toThrow(/CRC/);
  });
});

describe("FileUploadInfo + filename sanitization", () => {
  it("serializes the comma-joined struct with a trailing NUL", () => {
    const buf = packFileUploadInfo({
      name: "tower.gcode",
      size: 123,
      md5: "deadbeef",
      userName: "ankerts",
      userId: "-",
      machineId: "-",
    });
    expect(buf[buf.length - 1]).toBe(0);
    expect(buf.subarray(0, buf.length - 1).toString("utf8")).toBe(
      "0,tower.gcode,123,deadbeef,ankerts,-,-",
    );
  });

  it("sanitizes unsafe filename characters", () => {
    // each non-whitelist char maps to "_" individually (space + "(" → "__")
    expect(sanitizeFilename("/tmp/my model (v2).gcode")).toBe("my_model__v2_.gcode");
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
  });
});
