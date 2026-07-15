import { describe, expect, it } from "vitest";

import { lineIndexAt, parseLrc } from "./lrc";

describe("parseLrc", () => {
  it("parses line-timed LRC and ignores metadata tags", () => {
    const lines = parseLrc(
      ["[ar:Harry Dacre]", "[00:12.50]Daisy, Daisy", "[0:20]give me your answer do", ""].join("\n"),
    );
    expect(lines).toEqual([
      { time: 12.5, text: "Daisy, Daisy" },
      { time: 20, text: "give me your answer do" },
    ]);
  });

  it("expands repeated timestamps onto the same text", () => {
    const lines = parseLrc("[00:05.00][00:25.00]la la la");
    expect(lines.map((l) => l.time)).toEqual([5, 25]);
    expect(lines[1]!.text).toBe("la la la");
  });

  it("parses enhanced LRC word timing", () => {
    const line = parseLrc("[00:10.00]<00:10.00>Dai <00:10.90>sy, <00:11.70>Daisy")[0]!;
    expect(line.text).toBe("Dai sy, Daisy");
    expect(line.words).toEqual([
      { time: 10, text: "Dai" },
      { time: 10.9, text: "sy," },
      { time: 11.7, text: "Daisy" },
    ]);
  });

  it("sorts by time and pads fractional seconds correctly", () => {
    const lines = parseLrc("[00:30.5]late\n[00:01.05]early");
    expect(lines[0]).toEqual({ time: 1.05, text: "early" });
    expect(lines[1]!.time).toBe(30.5);
  });
});

describe("lineIndexAt", () => {
  const lines = parseLrc("[00:05.00]one\n[00:10.00]two");
  it("is -1 before the first line, then tracks the current line", () => {
    expect(lineIndexAt(lines, 0)).toBe(-1);
    expect(lineIndexAt(lines, 5)).toBe(0);
    expect(lineIndexAt(lines, 9.99)).toBe(0);
    expect(lineIndexAt(lines, 99)).toBe(1);
  });
});
