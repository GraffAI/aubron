import { describe, expect, it } from "vitest";

import { concatMp3, stripId3 } from "./mp3.js";

/** A fake ID3v2.4 tag of `payload` bytes (synchsafe size, no footer). */
function id3v2(payload: number): Buffer {
  const h = Buffer.alloc(10 + payload);
  h.write("ID3");
  h[3] = 0x04;
  // synchsafe size in bytes 6..9 (payload < 128 fits the low byte)
  h[9] = payload;
  return h;
}

const frames = Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x11, 0x22, 0x33]);
const id3v1 = Buffer.concat([Buffer.from("TAG"), Buffer.alloc(125)]);

describe("stripId3", () => {
  it("removes a leading ID3v2 tag", () => {
    expect(stripId3(Buffer.concat([id3v2(8), frames])).equals(frames)).toBe(true);
  });

  it("removes a trailing ID3v1 tag", () => {
    expect(stripId3(Buffer.concat([frames, id3v1])).equals(frames)).toBe(true);
  });

  it("removes both at once", () => {
    expect(stripId3(Buffer.concat([id3v2(4), frames, id3v1])).equals(frames)).toBe(true);
  });

  it("leaves tagless frame data untouched", () => {
    expect(stripId3(frames).equals(frames)).toBe(true);
  });
});

describe("concatMp3", () => {
  it("joins the frame data of each part, tags stripped", () => {
    const a = Buffer.concat([id3v2(6), frames]);
    const b = Buffer.concat([frames, id3v1]);
    expect(concatMp3([a, b]).equals(Buffer.concat([frames, frames]))).toBe(true);
  });
});
