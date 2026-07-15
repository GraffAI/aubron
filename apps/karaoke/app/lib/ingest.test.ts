import { describe, expect, it } from "vitest";

import { audioExt, slugify } from "./ingest";
import { pickStems } from "./pipeline";

describe("slugify", () => {
  it("makes url-safe ids", () => {
    expect(slugify("Beyoncé — CRAZY IN LOVE (feat. JAY-Z)")).toBe(
      "beyonce-crazy-in-love-feat-jay-z",
    );
    expect(slugify("   ")).toBe("song");
  });
});

describe("audioExt", () => {
  it("maps extensions to mime types, ignoring query strings", () => {
    expect(audioExt("https://x.test/out/vocals.wav?sig=abc")).toEqual({
      ext: "wav",
      mime: "audio/wav",
    });
    expect(audioExt("originals/abc.m4a")).toEqual({ ext: "m4a", mime: "audio/mp4" });
    expect(audioExt("no-extension")).toEqual({ ext: "mp3", mime: "audio/mpeg" });
  });
});

describe("pickStems", () => {
  it("accepts the common demucs output spellings", () => {
    expect(pickStems({ vocals: "v.mp3", no_vocals: "i.mp3" })).toEqual({
      vocals: "v.mp3",
      instrumental: "i.mp3",
    });
    expect(pickStems({ vocals: "v.mp3", accompaniment: "i.mp3" }).instrumental).toBe("i.mp3");
    expect(pickStems({ vocals: "v.mp3", other: "i.mp3" }).instrumental).toBe("i.mp3");
  });

  it("returns empty for unrecognized shapes", () => {
    expect(pickStems(null)).toEqual({});
    expect(pickStems("a-url")).toEqual({});
    expect(pickStems({ drums: "d.mp3" })).toEqual({ vocals: undefined, instrumental: undefined });
  });
});
