import { describe, expect, it } from "vitest";
import { BufReader, BufWriter } from "./binary.js";

describe("BufWriter/BufReader round-trips", () => {
  it("round-trips integers in both endiannesses", () => {
    const buf = new BufWriter()
      .u8(0x4d)
      .u16le(0x1234)
      .u16be(0x1234)
      .u32le(0xdeadbeef)
      .u32be(0xdeadbeef)
      .i32be(-5)
      .build();

    const r = new BufReader(buf);
    expect(r.u8()).toBe(0x4d);
    expect(r.u16le()).toBe(0x1234);
    expect(r.u16be()).toBe(0x1234);
    expect(r.u32le()).toBe(0xdeadbeef);
    expect(r.u32be()).toBe(0xdeadbeef);
    expect(r.i32be()).toBe(-5);
    expect(r.remaining).toBe(0);
  });

  it("round-trips an IPv4 address (reversed little-endian quad)", () => {
    const buf = new BufWriter().ipv4("192.168.1.42").build();
    // stored reversed: 42,1,168,192
    expect([...buf]).toEqual([42, 1, 168, 192]);
    expect(new BufReader(buf).ipv4()).toBe("192.168.1.42");
  });

  it("round-trips a fixed NUL-terminated string and trims padding", () => {
    const buf = new BufWriter().string("EUPRAKM", 8).build();
    expect(buf.length).toBe(8);
    expect(buf[7]).toBe(0);
    expect(new BufReader(buf).string(8)).toBe("EUPRAKM");
  });

  it("validates magic signatures", () => {
    const buf = new BufWriter().bytes(Buffer.from("XZYH", "ascii")).build();
    expect(new BufReader(buf).magic(Buffer.from("XZYH", "ascii")).toString()).toBe("XZYH");
    expect(() => new BufReader(buf).magic(Buffer.from("AABB", "ascii"))).toThrow(/magic/);
  });

  it("throws on buffer underrun", () => {
    expect(() => new BufReader(Buffer.alloc(1)).u32be()).toThrow(/underrun/);
  });
});
