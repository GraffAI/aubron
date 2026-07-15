import { describe, expect, it } from "vitest";

import { readId3 } from "./id3";

/** Build a minimal ID3v2.3 buffer with the given text frames. */
function id3v2(frames: Record<string, string>): ArrayBuffer {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const [id, value] of Object.entries(frames)) {
    const text = encoder.encode(value);
    const frame = new Uint8Array(10 + 1 + text.length);
    frame.set(encoder.encode(id), 0);
    new DataView(frame.buffer).setUint32(4, 1 + text.length); // v2.3 plain size
    frame[10] = 3; // utf-8 encoding byte
    frame.set(text, 11);
    chunks.push(frame);
  }
  const body = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0) + 64); // + padding
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  const header = new Uint8Array(10);
  header.set(encoder.encode("ID3"), 0);
  header[3] = 3; // v2.3
  // syncsafe size
  header[6] = (body.length >> 21) & 0x7f;
  header[7] = (body.length >> 14) & 0x7f;
  header[8] = (body.length >> 7) & 0x7f;
  header[9] = body.length & 0x7f;
  const out = new Uint8Array(10 + body.length);
  out.set(header, 0);
  out.set(body, 10);
  return out.buffer;
}

describe("readId3", () => {
  it("reads v2.3 text frames", () => {
    const tags = readId3(id3v2({ TIT2: "Daisy Bell", TPE1: "Harry Dacre", TALB: "1892" }));
    expect(tags).toEqual({ title: "Daisy Bell", artist: "Harry Dacre", album: "1892" });
  });

  it("returns empty tags for non-tagged data", () => {
    expect(readId3(new Uint8Array([0xff, 0xfb, 0x90, 0x00]).buffer)).toEqual({});
  });

  it("falls back to the ID3v1 trailer", () => {
    const buf = new Uint8Array(200);
    const encoder = new TextEncoder();
    const trailer = buf.subarray(buf.length - 128);
    trailer.set(encoder.encode("TAG"), 0);
    trailer.set(encoder.encode("Trailer Title"), 3);
    trailer.set(encoder.encode("Trailer Artist"), 33);
    const tags = readId3(buf.buffer);
    expect(tags.title).toBe("Trailer Title");
    expect(tags.artist).toBe("Trailer Artist");
  });
});
