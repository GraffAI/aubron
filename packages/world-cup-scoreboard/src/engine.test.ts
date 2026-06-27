import { describe, expect, it } from "vitest";

import { detectGoal, pickMatch } from "./engine.js";
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
