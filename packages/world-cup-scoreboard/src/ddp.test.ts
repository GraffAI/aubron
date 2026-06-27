import { describe, expect, it } from "vitest";

import { buildPackets } from "./ddp.js";

describe("buildPackets", () => {
  it("splits a 960-LED frame into two packets with PUSH only on the last", () => {
    const rgb = new Uint8Array(960 * 3); // 2880 channels
    const packets = buildPackets(rgb, 0);
    expect(packets).toHaveLength(2);

    const [a, b] = packets;
    // Packet 1: VER1, no PUSH, RGB24, display id, offset 0, len 1440.
    expect(a![0]).toBe(0x40);
    expect(a![2]).toBe(0x0b);
    expect(a![3]).toBe(0x01);
    expect(a!.readUInt32BE(4)).toBe(0);
    expect(a!.readUInt16BE(8)).toBe(1440);
    expect(a!.length).toBe(10 + 1440);

    // Packet 2: VER1 | PUSH, offset 1440, len 1440.
    expect(b![0]).toBe(0x41);
    expect(b!.readUInt32BE(4)).toBe(1440);
    expect(b!.readUInt16BE(8)).toBe(1440);
  });

  it("fits a small frame in a single pushed packet", () => {
    const packets = buildPackets(new Uint8Array(30), 0); // 10 LEDs
    expect(packets).toHaveLength(1);
    expect(packets[0]![0]).toBe(0x41); // PUSH set
    expect(packets[0]!.readUInt16BE(8)).toBe(30);
  });

  it("copies the pixel bytes into the payload after the 10-byte header", () => {
    const rgb = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const [p] = buildPackets(rgb, 0);
    expect([...p!.subarray(10)]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("advances the sequence counter and wraps at 16", () => {
    const rgb = new Uint8Array(30);
    expect(buildPackets(rgb, 15)[0]![1]).toBe(15);
    // Two packets from seq 15 → 15 then 0.
    const two = buildPackets(new Uint8Array(960 * 3), 15);
    expect(two[0]![1]).toBe(15);
    expect(two[1]![1]).toBe(0);
  });
});
