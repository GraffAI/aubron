import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFootballProvider } from "./apiFootball.js";
import { footballDataProvider } from "./footballData.js";
import { mockProvider } from "./mock.js";

function stubFetch(payload: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => payload })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("footballDataProvider", () => {
  it("normalizes WC matches, mapping PAUSED→halftime and using tla codes", async () => {
    stubFetch({
      matches: [
        {
          id: 1,
          utcDate: "2026-06-27T19:00:00Z",
          status: "PAUSED",
          minute: 45,
          stage: "GROUP_STAGE",
          homeTeam: { tla: "BRA", shortName: "Brazil" },
          awayTeam: { tla: "ARG", shortName: "Argentina" },
          score: { fullTime: { home: 1, away: 0 } },
        },
        {
          id: 2,
          status: "POSTPONED",
          homeTeam: {},
          awayTeam: {},
          score: { fullTime: { home: null, away: null } },
          utcDate: "x",
        },
      ],
    });
    const matches = await footballDataProvider("key").fetchMatches();
    expect(matches).toHaveLength(1); // postponed skipped
    expect(matches[0]).toMatchObject({ status: "halftime", minute: 45, stage: "GROUP" });
    expect(matches[0]!.home.team.code).toBe("BRA");
    expect(matches[0]!.home.score).toBe(1);
  });
});

describe("apiFootballProvider", () => {
  it("normalizes fixtures, mapping 1H→live and resolving teams by name", async () => {
    stubFetch({
      response: [
        {
          fixture: {
            id: 99,
            date: "2026-06-27T19:00:00+00:00",
            status: { short: "1H", elapsed: 23 },
          },
          league: { round: "Group Stage - 1" },
          teams: { home: { name: "England" }, away: { name: "France" } },
          goals: { home: 2, away: 1 },
        },
      ],
    });
    const matches = await apiFootballProvider("key").fetchMatches();
    expect(matches[0]).toMatchObject({ status: "live", minute: 23, stage: "GROUP" });
    expect(matches[0]!.home.team.code).toBe("ENG");
    expect(matches[0]!.away.score).toBe(1);
  });
});

describe("mockProvider", () => {
  it("progresses from scheduled through goals to finished as time advances", async () => {
    let t = 0;
    const provider = mockProvider({ speed: 10, now: () => t });

    t = 0; // 0' → live, no goals yet
    expect((await provider.fetchMatches())[0]!.status).toBe("live");

    t = 2000; // 20 match-minutes → home goal at 12'
    const mid = (await provider.fetchMatches())[0]!;
    expect(mid.home.score).toBe(1);
    expect(mid.away.score).toBe(0);

    t = 11_000; // past 95 effective → finished
    expect((await provider.fetchMatches())[0]!.status).toBe("finished");
  });
});
