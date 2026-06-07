/**
 * PPPP reliable channel — ported from the `Channel`/`CyclicU16` classes in the
 * reference `libflagship/ppppapi.py` and `cyclic.py`.
 *
 * PPPP rides a reliable, ordered byte stream on top of unreliable UDP: outbound
 * payloads are chunked into ≤1KB DRW packets with cyclic 16-bit sequence
 * numbers, retransmitted until ACKed; inbound DRW packets are reordered into a
 * contiguous stream for readers. The 16-bit counters wrap, so comparisons use
 * the cyclic ordering from `CyclicU16`.
 */
import { pktDrw } from "./packets.js";

const U16 = 0xffff;
const trunc = (n: number): number => n & U16;

/** Cyclic 16-bit `<` (wrap-aware), matching `CyclicU16.__lt__`. */
export function cyclicLt(a: number, b: number, wrap = 0x100): boolean {
  a = trunc(a);
  b = trunc(b);
  if ((a ^ b) & 0x8000) return trunc(a - wrap) < trunc(b - wrap);
  return a < b;
}

/** Cyclic 16-bit `>`. */
export function cyclicGt(a: number, b: number, wrap = 0x100): boolean {
  a = trunc(a);
  b = trunc(b);
  if ((a ^ b) & 0x8000) return trunc(a - wrap) > trunc(b - wrap);
  return a > b;
}

/** Cyclic 16-bit `>=`. */
export const cyclicGte = (a: number, b: number, wrap = 0x100): boolean => !cyclicLt(a, b, wrap);

const CHUNK = 1024;

interface TxEntry {
  deadline: number;
  data: Buffer;
}

export class Channel {
  private txCtr = 0;
  private txAck = 0;
  private readonly backlog: { ctr: number; data: Buffer }[] = [];
  private readonly txqueue = new Map<number, TxEntry>();
  private readonly acks = new Set<number>();
  private readonly ackWaiters: { ctr: number; resolve: () => void }[] = [];

  private rxCtr = 0;
  private readonly rxqueue = new Map<number, Buffer>();
  private rxBuf: Buffer = Buffer.alloc(0);
  private readonly rxWaiters: (() => void)[] = [];

  constructor(
    readonly index: number,
    private readonly timeoutMs = 500,
    private readonly maxInFlight = 64,
  ) {}

  // --- transmit side ---

  /** Queue `payload` for reliable delivery; returns its sequence range. */
  write(payload: Buffer): { start: number; done: number } {
    const start = this.txCtr;
    let rest = payload;
    do {
      const data = rest.subarray(0, CHUNK);
      rest = rest.subarray(CHUNK);
      this.backlog.push({ ctr: this.txCtr, data });
      this.txCtr = trunc(this.txCtr + 1);
    } while (rest.length > 0);
    return { start, done: this.txCtr };
  }

  /** Resolve once every chunk up to (but excluding) `done` has been ACKed. */
  ackUpTo(done: number): Promise<void> {
    if (cyclicGte(this.txAck, done)) return Promise.resolve();
    return new Promise<void>((resolve) => this.ackWaiters.push({ ctr: done, resolve }));
  }

  /** Apply received ACKs, advancing `txAck` and releasing waiters. */
  rxAck(acks: readonly number[]): void {
    for (const a of acks) {
      this.txqueue.delete(a);
      if (cyclicGte(a, this.txAck)) this.acks.add(a);
    }
    while (this.acks.has(this.txAck)) {
      this.acks.delete(this.txAck);
      this.txAck = trunc(this.txAck + 1);
    }
    for (let i = this.ackWaiters.length - 1; i >= 0; i--) {
      if (cyclicGte(this.txAck, this.ackWaiters[i]!.ctr)) {
        this.ackWaiters.splice(i, 1)[0]!.resolve();
      }
    }
  }

  /** Produce DRW packets to (re)transmit; called on each poll tick. */
  poll(now: number): Buffer[] {
    while (this.backlog.length && this.txqueue.size < this.maxInFlight) {
      const item = this.backlog.shift()!;
      this.txqueue.set(item.ctr, { deadline: now, data: item.data });
    }
    const out: Buffer[] = [];
    for (const [ctr, entry] of this.txqueue) {
      if (entry.deadline <= now) {
        out.push(pktDrw(this.index, ctr, entry.data));
        entry.deadline = now + this.timeoutMs;
      }
    }
    return out;
  }

  /** True once all queued writes have been fully ACKed. */
  get drained(): boolean {
    return this.backlog.length === 0 && this.txqueue.size === 0;
  }

  // --- receive side ---

  /** Ingest a received DRW chunk, reordering into the contiguous stream. */
  rxDrw(index: number, data: Buffer): void {
    if (cyclicGt(this.rxCtr, index)) return; // already have it
    this.rxqueue.set(trunc(index), data);
    let advanced = false;
    while (this.rxqueue.has(this.rxCtr)) {
      const chunk = this.rxqueue.get(this.rxCtr)!;
      this.rxqueue.delete(this.rxCtr);
      this.rxCtr = trunc(this.rxCtr + 1);
      this.rxBuf = Buffer.concat([this.rxBuf, chunk]);
      advanced = true;
    }
    if (advanced) {
      for (const w of this.rxWaiters.splice(0)) w();
    }
  }

  private waitForData(timeoutMs?: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer =
        timeoutMs !== undefined
          ? setTimeout(() => {
              const i = this.rxWaiters.indexOf(onData);
              if (i >= 0) this.rxWaiters.splice(i, 1);
              reject(new Error("channel read timeout"));
            }, timeoutMs)
          : undefined;
      const onData = (): void => {
        if (timer) clearTimeout(timer);
        resolve();
      };
      this.rxWaiters.push(onData);
    });
  }

  /** Read exactly `n` bytes from the reassembled stream (awaiting more). */
  async read(n: number, timeoutMs?: number): Promise<Buffer> {
    while (this.rxBuf.length < n) {
      await this.waitForData(timeoutMs);
    }
    const out = this.rxBuf.subarray(0, n);
    this.rxBuf = this.rxBuf.subarray(n);
    return Buffer.from(out);
  }
}
