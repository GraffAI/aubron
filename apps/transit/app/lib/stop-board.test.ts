// getStopBoard against REAL arrivals-and-departures payloads for Westlake's two
// Link platforms (40_1121 / 40_1108), captured from the live feed in the same
// poll. fetch is stubbed to serve those payloads; the system clock is pinned to
// the capture instant so every relative time reads as it did live.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import feed from "./__fixtures__/oba-feed.json";
import { getStopBoard } from "./oba";

const A = feed.arrivalsA; // 40_1121
const B = feed.arrivalsB; // 40_1108

function stubFetch(payloads: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      const hit = Object.entries(payloads).find(([id]) =>
        u.includes(`arrivals-and-departures-for-stop/${encodeURIComponent(id)}`),
      );
      if (!hit) return new Response("not found", { status: 404 });
      return Response.json({ code: 200, data: hit[1] });
    }),
  );
}

beforeEach(() => {
  // Pin "now" to the capture instant so relative times read as they did live —
  // but let timers tick (obaGet's retry backoff must be able to fire).
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(A.t);
  vi.stubEnv("OBA_API_KEY", "TEST");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("getStopBoard (real Westlake platforms)", () => {
  it("merges both platforms, drops departed trains, sorts by arrival", async () => {
    stubFetch({ [A.id]: A.data, [B.id]: B.data });
    const board = await getStopBoard("40_C03", [A.id, B.id]);

    expect(board.name).toBe("Westlake");
    // Both directions present (all platform-A arrivals head to Lynnwood; the
    // other platform serves the southbound trips).
    expect(board.arrivals.length).toBeGreaterThan(6);

    // GPS-confirmed-departed trains (stopsAway<0 AND distanceFromStop<0 — the
    // capture shows those always co-occur) are gone.
    for (const a of board.arrivals) {
      expect(a.stopsAway < 0 && (a.distanceFromStop ?? 0) < 0).toBe(false);
    }

    // Sorted soonest-first.
    const times = board.arrivals.map((a) => a.arrival);
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  it("ignores a wraparound predictedArrivalTime from the feed", async () => {
    stubFetch({ [A.id]: A.data, [B.id]: B.data });
    const board = await getStopBoard("40_C03", [A.id, B.id]);

    // The real payload contains a train physically 173m out whose
    // predictedArrivalTime is clamped to 00:59:59 of the PREVIOUS service day
    // (16h in the past). The board must fall back to its schedule, not sort a
    // sixteen-hour-old "arrival" to the top.
    const glitch = board.arrivals.find((a) => a.tripId.endsWith("100479_1088"));
    expect(glitch).toBeDefined();
    expect(glitch!.arrival).toBeGreaterThan(A.t - 15 * 60_000);
    expect(glitch!.minutesAway).toBeGreaterThan(-15);
  });

  it("dedupes a trip served by more than one platform query", async () => {
    // Same payload behind both ids — every arrival is a duplicate pair.
    stubFetch({ [A.id]: A.data, [B.id]: A.data });
    const board = await getStopBoard("40_C03", [A.id, B.id]);
    const keys = board.arrivals.map((a) => `${a.tripId}-${a.arrival}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps GTFS colors on each arrival", async () => {
    stubFetch({ [A.id]: A.data, [B.id]: B.data });
    const board = await getStopBoard("40_C03", [A.id, B.id]);
    const one = board.arrivals.find((a) => a.shortName === "1 Line");
    const two = board.arrivals.find((a) => a.shortName === "2 Line");
    expect(one?.color).toBe("28813F");
    expect(two?.color).toBe("007CAD");
  });

  it("survives one platform failing (serves the other)", async () => {
    stubFetch({ [A.id]: A.data }); // B 404s
    const board = await getStopBoard("40_C03", [A.id, B.id]);
    expect(board.name).toBe("Westlake");
    expect(board.arrivals.length).toBeGreaterThan(0);
  });
});
