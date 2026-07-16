import { describe, expect, it } from "vitest";

import { parseLrc } from "./lrc";
import { lyricsToPlainLines, retimeLyrics } from "./retime";

describe("lyricsToPlainLines", () => {
  it("strips LRC tags down to text lines", () => {
    expect(
      lyricsToPlainLines("[00:05.00]<00:05.00>Daisy, <00:06.00>Daisy\n[00:10.00]give me"),
    ).toEqual(["Daisy, Daisy", "give me"]);
  });

  it("passes plain text through, dropping metadata tags", () => {
    expect(lyricsToPlainLines("[ar:Someone]\nDaisy, Daisy\n\ngive me your answer")).toEqual([
      "Daisy, Daisy",
      "give me your answer",
    ]);
  });
});

describe("retimeLyrics", () => {
  it("transplants heard timings onto the provider text, punctuation and case aside", () => {
    const lrc = retimeLyrics("Daisy, Daisy\nGive me your answer, do", [
      { word: "daisy", start: 10 },
      { word: "Daisy", start: 12 },
      { word: "give", start: 14 },
      { word: "me", start: 14.5 },
      { word: "your", start: 15 },
      { word: "answer", start: 15.5 },
      { word: "do.", start: 17 },
    ]);
    const lines = parseLrc(lrc!);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.time).toBe(10);
    // Provider text survives (punctuation intact), timing is Whisper's.
    expect(lines[0]!.words).toEqual([
      { time: 10, text: "Daisy," },
      { time: 12, text: "Daisy" },
    ]);
    expect(lines[1]!.words?.map((w) => w.text)).toEqual(["Give", "me", "your", "answer,", "do"]);
    expect(lines[1]!.words?.map((w) => w.time)).toEqual([14, 14.5, 15, 15.5, 17]);
  });

  it("interpolates words Whisper missed and ignores words it invented", () => {
    const lrc = retimeLyrics("one two three four five", [
      { word: "one", start: 0 },
      { word: "hmm", start: 0.5 }, // ad-lib whisper heard, not in the sheet
      { word: "two", start: 2 },
      // "three" and "four" unheard
      { word: "five", start: 8 },
    ]);
    const words = parseLrc(lrc!)[0]!.words!;
    expect(words.map((w) => w.text)).toEqual(["one", "two", "three", "four", "five"]);
    expect(words[0]!.time).toBe(0);
    expect(words[1]!.time).toBe(2);
    // interpolated between 2s and 8s
    expect(words[2]!.time).toBeCloseTo(4, 5);
    expect(words[3]!.time).toBeCloseTo(6, 5);
    expect(words[4]!.time).toBe(8);
  });

  it("keeps timestamps monotonic", () => {
    const lrc = retimeLyrics("a b c", [
      { word: "a", start: 5 },
      { word: "b", start: 3 }, // out of order from a confused aligner
      { word: "c", start: 6 },
    ]);
    const words = parseLrc(lrc!)[0]!.words!;
    expect(words.map((w) => w.time)).toEqual([5, 5, 6]);
  });

  it("returns null when the sheet doesn't match what was heard", () => {
    expect(
      retimeLyrics("completely different unrelated lyrics here", [
        { word: "nothing", start: 1 },
        { word: "matches", start: 2 },
        { word: "at", start: 3 },
        { word: "all", start: 4 },
      ]),
    ).toBeNull();
  });

  it("returns null on empty inputs", () => {
    expect(retimeLyrics("", [{ word: "x", start: 1 }])).toBeNull();
    expect(retimeLyrics("some words", [])).toBeNull();
  });
});
