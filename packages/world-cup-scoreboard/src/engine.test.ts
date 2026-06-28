import { describe, expect, it } from "vitest";

import { detectGoal, pickMatch, selectDisplaySet } from "./engine.js";
import type { Match } from "./model.js";
import { resolveTeam } from "./teams.js";

const cfg = { upcomingWithinMin: 30, finishedLingerMin: 10 };
const side = (code: string, name: string, score: number) => ({
  team: resolveTeam({ code, name }),
  score,
});

function match(over: Partial<Match> & Pick<Match, "id" | "status">): Match {
  return {
    home: side("ENG", "England", 0),
    away: side("FRA", "France", 0),
    ...over,
  };
}

describe("pickMatch", () => {
  const now = new Date("2026-06-27T19:30:00Z");

  it("prefers a live match over scheduled/finished", () => {
    const matches = [
      match({ id: "a", status: "scheduled", kickoff: "2026-06-27T19:45:00Z" }),
      match({ id: "b", status: "live", minute: 30 }),
    ];
    expect(pickMatch(matches, now, cfg)?.id).toBe("b");
  });

  it("prefers the more-advanced of two live matches", () => {
    const matches = [
      match({ id: "a", status: "live", minute: 12 }),
      match({ id: "b", status: "live", minute: 70 }),
    ];
    expect(pickMatch(matches, now, cfg)?.id).toBe("b");
  });

  it("shows an upcoming match only within the window", () => {
    const soon = match({ id: "soon", status: "scheduled", kickoff: "2026-06-27T19:50:00Z" });
    const later = match({ id: "later", status: "scheduled", kickoff: "2026-06-27T23:00:00Z" });
    expect(pickMatch([later, soon], now, cfg)?.id).toBe("soon");
    expect(pickMatch([later], now, cfg)).toBeNull();
  });

  it("returns null when nothing is relevant", () => {
    expect(pickMatch([], now, cfg)).toBeNull();
  });
});

describe("selectDisplaySet", () => {
  const now = new Date("2026-06-27T19:30:00Z");

  it("returns every live match (most-advanced first) to rotate through", () => {
    const matches = [
      match({ id: "a", status: "live", minute: 12 }),
      match({ id: "b", status: "live", minute: 70 }),
      match({ id: "c", status: "halftime", minute: 45 }),
      match({ id: "d", status: "scheduled", kickoff: "2026-06-27T23:00:00Z" }),
    ];
    expect(selectDisplaySet(matches, now, cfg).map((m) => m.id)).toEqual(["b", "a", "c"]);
  });

  it("shows only live matches when any are in play (preempts upcoming + finished)", () => {
    const matches = [
      match({ id: "live", status: "live", minute: 30 }),
      match({ id: "soon", status: "scheduled", kickoff: "2026-06-27T19:50:00Z" }), // 20' out
      match({ id: "done", status: "finished", kickoff: "2026-06-27T17:33:00Z" }), // FT ~2' ago
    ];
    expect(selectDisplaySet(matches, now, cfg).map((m) => m.id)).toEqual(["live"]);
  });

  it("falls back to a single upcoming/finished pick when nothing is live", () => {
    const matches = [match({ id: "soon", status: "scheduled", kickoff: "2026-06-27T19:50:00Z" })];
    expect(selectDisplaySet(matches, now, cfg).map((m) => m.id)).toEqual(["soon"]);
  });

  it("keeps a just-finished match in the linger window but drops older ones", () => {
    const min = (n: number) => new Date(now.getTime() + n * 60000).toISOString();
    const recent = match({ id: "recent", status: "finished", kickoff: min(-117) }); // FT ~2' ago
    const old = match({ id: "old", status: "finished", kickoff: min(-140) }); // FT ~25' ago
    const ids = selectDisplaySet([recent, old], now, cfg).map((m) => m.id);
    expect(ids).toContain("recent");
    expect(ids).not.toContain("old");
  });

  it("is empty when nothing is relevant", () => {
    const later = match({ id: "later", status: "scheduled", kickoff: "2026-06-27T23:00:00Z" });
    expect(selectDisplaySet([later], now, cfg)).toEqual([]);
    expect(selectDisplaySet([], now, cfg)).toEqual([]);
  });
});

describe("detectGoal", () => {
  const prev = match({
    id: "x",
    status: "live",
    home: side("ENG", "England", 1),
    away: side("FRA", "France", 0),
  });

  it("fires for the side whose score increased", () => {
    const next = match({
      id: "x",
      status: "live",
      home: side("ENG", "England", 1),
      away: side("FRA", "France", 1),
    });
    expect(detectGoal(prev, next)?.side).toBe("away");
    expect(detectGoal(prev, next)?.team.code).toBe("FRA");
  });

  it("does not fire on first observation or a different match", () => {
    expect(detectGoal(undefined, prev)).toBeNull();
    const other = match({
      id: "y",
      status: "live",
      home: side("ENG", "England", 5),
      away: side("FRA", "France", 5),
    });
    expect(detectGoal(prev, other)).toBeNull();
  });

  it("does not fire when the score is unchanged", () => {
    expect(detectGoal(prev, prev)).toBeNull();
  });
});
