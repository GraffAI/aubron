// The replay clock's frame lookup.

import { describe, expect, it } from "vitest";

import { frameIndexAt } from "./replay";

const frames = [{ t: 1000 }, { t: 2000 }, { t: 3000 }, { t: 4000 }];

describe("frameIndexAt", () => {
  it("is -1 before the recording starts", () => {
    expect(frameIndexAt(frames, 999)).toBe(-1);
  });

  it("lands exactly on a frame boundary", () => {
    expect(frameIndexAt(frames, 1000)).toBe(0);
    expect(frameIndexAt(frames, 3000)).toBe(2);
  });

  it("holds the latest frame between samples and past the end", () => {
    expect(frameIndexAt(frames, 2999)).toBe(1);
    expect(frameIndexAt(frames, 99999)).toBe(3);
  });

  it("handles a single-frame recording", () => {
    expect(frameIndexAt([{ t: 5 }], 4)).toBe(-1);
    expect(frameIndexAt([{ t: 5 }], 6)).toBe(0);
  });
});
