import { describe, expect, it } from "vitest";
import { Channel, cyclicGt, cyclicLt } from "./channel.js";
import { parseMessage } from "./packets.js";

describe("cyclic 16-bit comparisons (CyclicU16)", () => {
  it("handles ordinary ordering", () => {
    expect(cyclicLt(0x1, 0x2)).toBe(true);
    expect(cyclicLt(0x2, 0x1)).toBe(false);
    expect(cyclicGt(0x120, 0x90)).toBe(true);
  });

  it("handles wraparound near 0xFFFF", () => {
    expect(cyclicLt(0xfffe, 0xffff)).toBe(true);
    expect(cyclicLt(0xfffe, 0x10)).toBe(true); // wrapped: 0x10 is "after"
    expect(cyclicLt(0xfffe, 0x110)).toBe(false); // beyond wrap window
    expect(cyclicGt(0x10, 0xfffe)).toBe(true);
  });
});

describe("Channel transmit chunking", () => {
  it("splits payloads into 1KB DRW packets and tracks the sequence range", () => {
    const ch = new Channel(1);
    const { start, done } = ch.write(Buffer.alloc(2500));
    expect(start).toBe(0);
    expect(done).toBe(3); // ceil(2500/1024) = 3 chunks → ctr 0,1,2 → done=3

    const pkts = ch.poll(Date.now());
    expect(pkts.length).toBe(3);
    // each is a DRW on channel 1 with the right index
    expect(parseMessage(pkts[0]!).index).toBe(0);
    expect(parseMessage(pkts[2]!).index).toBe(2);
  });

  it("ackUpTo resolves once all chunks are ACKed", async () => {
    const ch = new Channel(1);
    const { done } = ch.write(Buffer.alloc(2000)); // 2 chunks
    ch.poll(Date.now());
    const waiter = ch.ackUpTo(done);
    ch.rxAck([0]);
    ch.rxAck([1]);
    await expect(waiter).resolves.toBeUndefined();
    expect(ch.drained).toBe(true);
  });
});

describe("Channel receive reassembly", () => {
  it("reorders out-of-order DRW chunks into a contiguous stream", async () => {
    const ch = new Channel(1);
    // deliver index 1 before index 0
    ch.rxDrw(1, Buffer.from("world"));
    ch.rxDrw(0, Buffer.from("hello"));
    const got = await ch.read(10, 100);
    expect(got.toString()).toBe("helloworld");
  });

  it("read awaits data that arrives later", async () => {
    const ch = new Channel(1);
    const p = ch.read(3, 500);
    ch.rxDrw(0, Buffer.from("abc"));
    expect((await p).toString()).toBe("abc");
  });
});
