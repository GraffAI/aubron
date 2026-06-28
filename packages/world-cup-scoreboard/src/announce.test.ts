import { afterEach, describe, expect, it, vi } from "vitest";

import { webhookAnnouncer } from "./announce.js";
import { goalAnnouncement } from "./engine.js";
import type { Match } from "./model.js";
import { resolveTeam } from "./teams.js";

const side = (code: string, name: string, score: number) => ({
  team: resolveTeam({ code, name }),
  score,
});

const scored: Match = {
  id: "ENGFRA",
  status: "live",
  minute: 67,
  stage: "GROUP A",
  home: side("ENG", "England", 2),
  away: side("FRA", "France", 1),
};

describe("goalAnnouncement", () => {
  it("captures the scoring team, scoreline, minute and lead change", () => {
    expect(goalAnnouncement(scored, scored.home.team, "WC", true)).toEqual({
      competition: "WC",
      matchId: "ENGFRA",
      team: "ENG",
      teamName: "England",
      home: "ENG",
      away: "FRA",
      homeName: "England",
      awayName: "France",
      homeScore: 2,
      awayScore: 1,
      minute: 67,
      leadChange: true,
    });
  });

  it("uses null when the minute is unknown", () => {
    const noMinute: Match = {
      id: "X",
      status: "live",
      home: side("ENG", "England", 1),
      away: side("FRA", "France", 0),
    };
    expect(goalAnnouncement(noMinute, noMinute.away.team, "WC", false).minute).toBeNull();
  });
});

describe("webhookAnnouncer", () => {
  afterEach(() => vi.unstubAllGlobals());

  const announcement = goalAnnouncement(scored, scored.home.team, "WC", true);

  it("POSTs the announcement as JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    webhookAnnouncer("http://hass.local/api/webhook/goal")(announcement);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://hass.local/api/webhook/goal");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual(announcement);
  });

  it("swallows network errors and logs them", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);
    const logs: string[] = [];

    expect(() => webhookAnnouncer("http://x", (m) => logs.push(m))(announcement)).not.toThrow();
    await vi.waitFor(() => expect(logs).toHaveLength(1));
    expect(logs[0]).toContain("ECONNREFUSED");
  });

  it("logs non-OK responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" }),
    );
    const logs: string[] = [];

    webhookAnnouncer("http://x", (m) => logs.push(m))(announcement);
    await vi.waitFor(() => expect(logs).toHaveLength(1));
    expect(logs[0]).toContain("404");
  });
});
