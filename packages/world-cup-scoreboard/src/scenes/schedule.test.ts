import { describe, expect, it } from "vitest";

import { buildMatch } from "../providers/types.js";
import type { MatchStatus } from "../model.js";
import { pstTime, selectFixtures } from "./schedule.js";

function fx(id: string, status: MatchStatus, kickoffIso: string) {
  return buildMatch({
    id,
    status,
    kickoff: kickoffIso,
    home: { code: "BRA", name: "Brazil", score: 0 },
    away: { code: "ARG", name: "Argentina", score: 0 },
  });
}

describe("pstTime", () => {
  it("formats an ISO instant as compact Pacific time", () => {
    // 2026-06-28T02:30:00Z = 19:30 PDT (UTC-7).
    expect(pstTime(new Date("2026-06-28T02:30:00Z"))).toBe("7:30P");
    // 2026-06-27T19:00:00Z = 12:00 PDT.
    expect(pstTime(new Date("2026-06-27T19:00:00Z"))).toBe("12:00P");
  });
});

describe("selectFixtures", () => {
  // Reference "now": 2026-06-27 ~noon Pacific.
  const now = new Date("2026-06-27T19:00:00Z");

  it("returns today's still-to-come fixtures in kickoff order", () => {
    const matches = [
      fx("late", "scheduled", "2026-06-28T02:00:00Z"), // 7pm PDT today
      fx("soon", "scheduled", "2026-06-27T22:00:00Z"), // 3pm PDT today
      fx("done", "finished", "2026-06-27T16:00:00Z"), // earlier today, finished
    ];
    const sel = selectFixtures(matches, now);
    expect(sel.day).toBe("TODAY");
    expect(sel.list.map((m) => m.id)).toEqual(["soon", "late"]);
  });

  it("keeps an in-progress match in today's list", () => {
    const sel = selectFixtures([fx("live", "live", "2026-06-27T18:30:00Z")], now);
    expect(sel.day).toBe("TODAY");
    expect(sel.list.map((m) => m.id)).toEqual(["live"]);
  });

  it("rolls over to tomorrow when nothing remains today", () => {
    const matches = [
      fx("done", "finished", "2026-06-27T16:00:00Z"),
      fx("tmrw", "scheduled", "2026-06-28T22:00:00Z"), // next Pacific day
    ];
    const sel = selectFixtures(matches, now);
    expect(sel.day).toBe("TOMORROW");
    expect(sel.list.map((m) => m.id)).toEqual(["tmrw"]);
  });
});
