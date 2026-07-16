import { afterEach, describe, expect, it } from "vitest";

import { audioExt, slugify } from "./ingest";
import { parseLrc } from "./lrc";
import { pickStems, whisperxToLrc } from "./pipeline";

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

describe("whisperxToLrc", () => {
  it("converts word-level segments into enhanced LRC our parser accepts", () => {
    const lrc = whisperxToLrc({
      segments: [
        {
          start: 61.2,
          text: " Daisy, Daisy",
          words: [
            { word: "Daisy,", start: 61.2, end: 61.9 },
            { word: "Daisy", start: 62.4, end: 63.0 },
          ],
        },
      ],
    });
    expect(lrc).toBe("[01:01.20]<01:01.20>Daisy, <01:02.40>Daisy");
    const lines = parseLrc(lrc!);
    expect(lines[0]!.words).toEqual([
      { time: 61.2, text: "Daisy," },
      { time: 62.4, text: "Daisy" },
    ]);
  });

  it("carries the previous timestamp for untimed words", () => {
    const lrc = whisperxToLrc({
      segments: [
        {
          start: 5,
          words: [{ word: "sing", start: 5 }, { word: "42" }, { word: "songs", start: 6.5 }],
        },
      ],
    });
    expect(lrc).toBe("[00:05.00]<00:05.00>sing <00:05.00>42 <00:06.50>songs");
  });

  it("falls back to line timing when a segment has no words", () => {
    expect(whisperxToLrc({ segments: [{ start: 10, text: "instrumental bridge" }] })).toBe(
      "[00:10.00]instrumental bridge",
    );
  });

  it("returns null for unrecognized shapes", () => {
    expect(whisperxToLrc(null)).toBeNull();
    expect(whisperxToLrc({ transcript: "hi" })).toBeNull();
    expect(whisperxToLrc({ segments: [] })).toBeNull();
  });
});

import { buildSeparationInput } from "./pipeline";

describe("buildSeparationInput", () => {
  afterEach(() => {
    delete process.env.REPLICATE_SEPARATION_INPUT;
  });

  it("defaults to the demucs two-stem dialect", () => {
    expect(buildSeparationInput("https://x/a.mp3")).toEqual({
      audio: "https://x/a.mp3",
      two_stems: "vocals",
      output_format: "mp3",
    });
  });

  it("merges quality overrides on top", () => {
    process.env.REPLICATE_SEPARATION_INPUT = '{"model_name":"htdemucs_ft","shifts":2}';
    expect(buildSeparationInput("u")).toMatchObject({
      audio: "u",
      model_name: "htdemucs_ft",
      shifts: 2,
      two_stems: "vocals",
    });
  });

  it("supports a different dialect: $AUDIO_URL substitution and null deletes", () => {
    process.env.REPLICATE_SEPARATION_INPUT =
      '{"input_audio":"$AUDIO_URL","audio":null,"two_stems":null,"stem_type":"vocals"}';
    expect(buildSeparationInput("https://signed")).toEqual({
      input_audio: "https://signed",
      stem_type: "vocals",
      output_format: "mp3",
    });
  });

  it("ignores malformed JSON rather than breaking separation", () => {
    process.env.REPLICATE_SEPARATION_INPUT = "{not json";
    expect(buildSeparationInput("u").audio).toBe("u");
  });
});
