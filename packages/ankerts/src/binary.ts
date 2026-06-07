/**
 * Tiny binary reader/writer, mirroring the struct helpers in the reference's
 * `libflagship/amtypes.py`. Big-endian is the default for the bare `u8/u16/u32`
 * helpers (matching `u8 = u8be` etc.); little-endian variants are explicit.
 *
 * Pure data manipulation — no I/O.
 */

export class BufReader {
  private offset = 0;

  constructor(private readonly buf: Buffer) {}

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  private take(n: number): Buffer {
    if (this.offset + n > this.buf.length) {
      throw new RangeError(`buffer underrun: need ${n}, have ${this.remaining}`);
    }
    const slice = this.buf.subarray(this.offset, this.offset + n);
    this.offset += n;
    return slice;
  }

  u8(): number {
    return this.take(1).readUInt8(0);
  }
  u16be(): number {
    return this.take(2).readUInt16BE(0);
  }
  u16le(): number {
    return this.take(2).readUInt16LE(0);
  }
  u32be(): number {
    return this.take(4).readUInt32BE(0);
  }
  u32le(): number {
    return this.take(4).readUInt32LE(0);
  }
  i32be(): number {
    return this.take(4).readInt32BE(0);
  }
  i32le(): number {
    return this.take(4).readInt32LE(0);
  }

  bytes(n: number): Buffer {
    return Buffer.from(this.take(n));
  }

  tail(): Buffer {
    return this.bytes(this.remaining);
  }

  /** Read `n` zero bytes, asserting they are all zero. */
  zeroes(n: number): Buffer {
    const b = this.take(n);
    for (const x of b) if (x !== 0) throw new Error("expected zero padding");
    return Buffer.from(b);
  }

  /** Read `expected.length` bytes and assert they match (a magic signature). */
  magic(expected: Buffer): Buffer {
    const b = this.take(expected.length);
    if (!b.equals(expected)) {
      throw new Error(`bad magic: expected ${expected.toString("hex")}, got ${b.toString("hex")}`);
    }
    return Buffer.from(b);
  }

  /** Fixed-width, NUL-terminated string field of `size` bytes (last byte NUL). */
  string(size: number): string {
    const b = this.take(size);
    if (b[size - 1] !== 0) throw new Error("expected NUL-terminated fixed string");
    let end = size - 1;
    // Trim at the first NUL so embedded padding is dropped.
    for (let i = 0; i < size; i++) {
      if (b[i] === 0) {
        end = i;
        break;
      }
    }
    return b.subarray(0, end).toString("utf8");
  }

  /** IPv4 address stored as 4 little-endian bytes (reversed dotted quad). */
  ipv4(): string {
    const b = this.take(4);
    return `${b[3]}.${b[2]}.${b[1]}.${b[0]}`;
  }
}

export class BufWriter {
  private chunks: Buffer[] = [];

  u8(v: number): this {
    const b = Buffer.alloc(1);
    b.writeUInt8(v & 0xff, 0);
    this.chunks.push(b);
    return this;
  }
  u16be(v: number): this {
    const b = Buffer.alloc(2);
    b.writeUInt16BE(v & 0xffff, 0);
    this.chunks.push(b);
    return this;
  }
  u16le(v: number): this {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(v & 0xffff, 0);
    this.chunks.push(b);
    return this;
  }
  u32be(v: number): this {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(v >>> 0, 0);
    this.chunks.push(b);
    return this;
  }
  u32le(v: number): this {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(v >>> 0, 0);
    this.chunks.push(b);
    return this;
  }
  i32be(v: number): this {
    const b = Buffer.alloc(4);
    b.writeInt32BE(v | 0, 0);
    this.chunks.push(b);
    return this;
  }
  i32le(v: number): this {
    const b = Buffer.alloc(4);
    b.writeInt32LE(v | 0, 0);
    this.chunks.push(b);
    return this;
  }

  bytes(b: Buffer): this {
    this.chunks.push(Buffer.from(b));
    return this;
  }

  zeroes(n: number): this {
    this.chunks.push(Buffer.alloc(n));
    return this;
  }

  /** Write a fixed-width string, NUL-padded to `size` bytes. */
  string(s: string, size: number): this {
    const b = Buffer.alloc(size);
    Buffer.from(s, "utf8").copy(b, 0, 0, Math.min(size - 1, Buffer.byteLength(s, "utf8")));
    this.chunks.push(b);
    return this;
  }

  ipv4(addr: string): this {
    const parts = addr.split(".").map((x) => parseInt(x, 10) & 0xff);
    if (parts.length !== 4) throw new Error(`invalid IPv4 address: ${addr}`);
    this.chunks.push(Buffer.from([parts[3]!, parts[2]!, parts[1]!, parts[0]!]));
    return this;
  }

  build(): Buffer {
    return Buffer.concat(this.chunks);
  }
}
