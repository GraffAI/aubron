import { describe, expect, it } from "vitest";

import { Canvas, hex } from "./canvas.js";
import { drawText, measure, small } from "./font.js";
import { renderFlag } from "./flags/draw.js";
import { flagFor } from "./flags/registry.js";
import { drawScoreboard } from "./scenes/scoreboard.js";
import { resolveTeam } from "./teams.js";
import type { Match } from "./model.js";

function lit(c: Canvas): number {
  let n = 0;
  for (let i = 0; i < c.data.length; i += 3) {
    if (c.data[i] || c.data[i + 1] || c.data[i + 2]) n++;
  }
  return n;
}

describe("font", () => {
  it("measures fixed-cell text width", () => {
    expect(measure(small, "ABC", 1)).toBe(11); // 3*3 + 2*1
  });

  it("draws glyph pixels and respects scale", () => {
    const a = new Canvas(12, 12);
    drawText(a, small, "1", 0, 0, hex("#FFFFFF"));
    const b = new Canvas(12, 12);
    drawText(b, small, "1", 0, 0, hex("#FFFFFF"), { scale: 2 });
    expect(lit(b)).toBe(lit(a) * 4);
  });
});

describe("flags", () => {
  it("renders an opaque flag sprite of the requested size", () => {
    const s = renderFlag(flagFor("FRA"), 14, 10);
    expect(s.width).toBe(14);
    expect(s.height).toBe(10);
    // Fully opaque.
    for (let i = 3; i < s.data.length; i += 4) expect(s.data[i]).toBe(255);
    // Left band blue-ish, right band red-ish (vertical tricolour).
    const at = (x: number, y: number): number => (y * 14 + x) * 4;
    expect(s.data[at(1, 5)! + 2]).toBeGreaterThan(s.data[at(1, 5)!]!); // more blue than red
    expect(s.data[at(12, 5)!]).toBeGreaterThan(s.data[at(12, 5)! + 2]!); // more red than blue
  });
});

describe("scoreboard", () => {
  it("renders without throwing and lights a reasonable number of pixels", () => {
    const c = new Canvas(32, 30);
    const m: Match = {
      id: "1",
      status: "live",
      minute: 67,
      home: { team: resolveTeam({ code: "ENG", name: "England" }), score: 2 },
      away: { team: resolveTeam({ code: "FRA", name: "France" }), score: 1 },
    };
    drawScoreboard(c, m, 0);
    expect(lit(c)).toBeGreaterThan(200);
  });
});
