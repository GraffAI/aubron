import { describe, expect, it } from "vitest";
import { unhex } from "../crypto.js";
import { MqttPktType, packMqttMessage, parseMqttMessage } from "./mqttframe.js";

const key = unhex("00112233445566778899aabbccddeeff"); // 16-byte AES-128 key

describe("MQTT framing round-trip", () => {
  const guid = "0f8fad5b-d9cb-469f-a165-70867728950e";

  it("packs and parses a gcode command payload", () => {
    const payload = { commandType: 0x0413, cmdData: "M115", cmdLen: 4 };
    const packed = packMqttMessage({ guid, payload, key, time: 1234 });

    const msg = parseMqttMessage(packed, key);
    expect(msg.packetType).toBe(MqttPktType.Single);
    expect(msg.deviceGuid).toBe(guid);
    expect(msg.time).toBe(1234);
    expect(msg.payload).toEqual(payload);
  });

  it("the header signals 'MA' and a valid checksum", () => {
    const packed = packMqttMessage({ guid, payload: { a: 1 }, key });
    expect(packed.subarray(0, 2).toString("ascii")).toBe("MA");
    // a full, valid packet XORs to zero across its length
    expect(packed.reduce((acc, b) => acc ^ b, 0)).toBe(0);
  });

  it("rejects a corrupted packet", () => {
    const packed = packMqttMessage({ guid, payload: { a: 1 }, key });
    packed[20] = packed[20]! ^ 0xff;
    expect(() => parseMqttMessage(packed, key)).toThrow();
  });
});
