// vehiclesFromTrips against REAL trips-for-route payloads captured from the
// live Puget Sound OBA feed (2026-07-06 afternoon service). The fixture values
// are verbatim from the API; lists were subset for size, nothing was edited.

import { describe, expect, it } from "vitest";

import feed from "./__fixtures__/oba-feed.json";
import { vehiclesFromTrips, type TripsResponse } from "./oba";
import { isRailType } from "./transit";

const tline = feed.tline.data as unknown as TripsResponse;
const tlineT = feed.tline.t; // wall clock at capture — "now" for age math
const keepRail = (r: { type: number }) => isRailType(r.type);

describe("vehiclesFromTrips (real T Line payload)", () => {
  it("keeps the in-progress trains and drops the schedule-position phantom", () => {
    // The payload has 4 trips; one (phase "", lastLocationUpdateTime 0) is a
    // not-yet-started run whose "position" is OBA's schedule interpolation, not
    // GPS — it must not appear as a train (measured live: ~16% of trip rows are
    // these phantoms, all parked at terminals).
    const vs = vehiclesFromTrips(tline, keepRail, tlineT);
    expect(tline.list).toHaveLength(4);
    expect(vs).toHaveLength(3);
    expect(vs.every((v) => v.hasGps)).toBe(true);
  });

  it("carries the fix timestamp and a fresh age for each real fix", () => {
    const vs = vehiclesFromTrips(tline, keepRail, tlineT);
    for (const v of vs) {
      expect(v.fixTime).toBeGreaterThan(0);
      // Capture happened seconds after the fixes: age must reflect that.
      expect(v.gpsAgeSec).toBe(Math.round((tlineT - v.fixTime!) / 1000));
      expect(v.gpsAgeSec!).toBeLessThan(120);
    }
  });

  it("labels by true route with mode, GTFS color and headsign", () => {
    const vs = vehiclesFromTrips(tline, keepRail, tlineT);
    for (const v of vs) {
      expect(v.shortName).toBe("T Line");
      expect(v.mode).toBe("light-rail");
      expect(v.color).toBe("F38B00");
      expect(["Tacoma Dome", "St Joseph"]).toContain(v.headsign);
    }
  });

  it("converts OBA orientation (CCW from east) to compass heading", () => {
    const vs = vehiclesFromTrips(tline, keepRail, tlineT);
    // Trip _145 reports orientation 312.49° (CCW from east) → 137.5° compass.
    const v = vs.find((x) => x.tripId.endsWith("_145"))!;
    expect(v.heading).toBeCloseTo((90 - 312.4930293000851 + 360) % 360, 3);
  });

  it("carries next-stop position + ETA for the forward prediction", () => {
    const vs = vehiclesFromTrips(tline, keepRail, tlineT);
    const v = vs.find((x) => x.tripId.endsWith("_214"))!;
    // From references: 40_T07-T1 (Convention Center), 32s away.
    expect(v.nextStopLon).toBeCloseTo(-122.4385, 5);
    expect(v.nextStopLat).toBeCloseTo(47.249514, 5);
    expect(v.nextStopTimeOffset).toBe(32);
  });

  it("respects keepRoute (a bus filter keeps nothing here)", () => {
    expect(vehiclesFromTrips(tline, (r) => r.type === 3, tlineT)).toHaveLength(0);
  });
});

describe("vehiclesFromTrips (real Sounder payload)", () => {
  const sounder = feed.sounder.data as unknown as TripsResponse;

  it("maps commuter rail with its GTFS steel-blue color", () => {
    const vs = vehiclesFromTrips(sounder, keepRail, feed.sounder.t);
    expect(vs.length).toBeGreaterThan(0);
    for (const v of vs) {
      expect(v.mode).toBe("rail");
      expect(v.shortName).toBe("S Line");
      expect(v.color).toBe("9AB6D3");
    }
  });

  it("falls back to longName when a route publishes an empty shortName", () => {
    // Amtrak Cascades (51_60) rides the same feed with shortName "" — as seen
    // live; here we clone the real payload onto the real Amtrak route record.
    const amtrak: TripsResponse = JSON.parse(JSON.stringify(sounder)) as TripsResponse;
    amtrak.references.routes = amtrak.references.routes.map((r) => ({
      ...r,
      id: "51_60",
      shortName: "",
      longName: "Amtrak Cascades",
      color: "677483",
    }));
    amtrak.references.trips = amtrak.references.trips.map((t) => ({ ...t, routeId: "51_60" }));
    const vs = vehiclesFromTrips(amtrak, keepRail, feed.sounder.t);
    expect(vs.length).toBeGreaterThan(0);
    expect(vs[0]!.shortName).toBe("Amtrak Cascades");
    expect(vs[0]!.color).toBe("677483");
  });
});

describe("schedule-only ghosts", () => {
  it("places an in-progress rail trip with no fix between its stops", () => {
    // Degrade a real in-progress trip to what the feed looks like when GPS
    // drops: no position, no fix timestamp — but stop offsets still counting.
    const ghosted: TripsResponse = JSON.parse(JSON.stringify(tline)) as TripsResponse;
    const trip = ghosted.list.find((t) => t.tripId.endsWith("_214"))!;
    trip.status = {
      ...trip.status,
      position: undefined,
      lastKnownLocation: undefined,
      lastLocationUpdateTime: 0,
      distanceAlongTrip: -1,
      closestStop: "40_T21-T1",
      closestStopTimeOffset: -30,
      nextStop: "40_T07-T1",
      nextStopTimeOffset: 60,
    };
    ghosted.list = [trip];
    const vs = vehiclesFromTrips(ghosted, keepRail, tlineT);
    expect(vs).toHaveLength(1);
    const g = vs[0]!;
    expect(g.hasGps).toBe(false);
    expect(g.gpsAgeSec).toBeUndefined();
    // 30s past the closest stop, 60s to the next → a third of the way along.
    const closest = { lon: -122.452839, lat: 47.256867 }; // 40_T21-T1 (real ref)
    const next = { lon: -122.4385, lat: 47.249514 }; // 40_T07-T1 (real ref)
    expect(g.lon).toBeCloseTo(closest.lon + (next.lon - closest.lon) / 3, 6);
    expect(g.lat).toBeCloseTo(closest.lat + (next.lat - closest.lat) / 3, 6);
  });

  it("drops a no-fix trip that is not in progress", () => {
    const ghosted: TripsResponse = JSON.parse(JSON.stringify(tline)) as TripsResponse;
    const trip = ghosted.list.find((t) => t.tripId.endsWith("_214"))!;
    trip.status = {
      ...trip.status,
      position: undefined,
      lastKnownLocation: undefined,
      lastLocationUpdateTime: 0,
      distanceAlongTrip: -1,
      phase: "",
    };
    ghosted.list = [trip];
    expect(vehiclesFromTrips(ghosted, keepRail, tlineT)).toHaveLength(0);
  });
});
