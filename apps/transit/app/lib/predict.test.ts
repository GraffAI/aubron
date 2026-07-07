// The forward-prediction policy (how far to dead-reckon a train ahead of its
// last fix). Numbers mirror the measured feed: Link cruises ~13 m/s median,
// fixes arrive ~20s apart and ~16s stale.

import { describe, expect, it } from "vitest";

import { predictMeters, type Motion } from "./useSmoothPositions";
import type { Vehicle } from "./transit";

const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: "t1",
  tripId: "t1",
  routeId: "40_100479",
  shortName: "1 Line",
  mode: "light-rail",
  lon: -122.33,
  lat: 47.61,
  heading: 0,
  deviation: 0,
  occupancy: "",
  predicted: true,
  headsign: "Lynnwood",
  hasGps: true,
  ...over,
});

const moving = (speed: number): Motion => ({
  lon: -122.33,
  lat: 47.61,
  time: 0,
  speed,
  heading: 0,
});

describe("predictMeters", () => {
  it("never predicts a ghost (no GPS)", () => {
    expect(predictMeters(vehicle({ hasGps: false }), moving(20))).toBe(0);
  });

  it("never predicts before seeing movement (heading unknown)", () => {
    expect(predictMeters(vehicle(), { ...moving(20), heading: NaN })).toBe(0);
    expect(predictMeters(vehicle(), undefined)).toBe(0);
  });

  it("never predicts a dwelling train (measured stationary)", () => {
    expect(predictMeters(vehicle(), moving(0))).toBe(0);
    expect(predictMeters(vehicle(), moving(1.9))).toBe(0);
  });

  it("carries a cruising train one horizon forward", () => {
    // 13 m/s (the measured median) with no next-stop info → 13 * 15s.
    expect(predictMeters(vehicle(), moving(13))).toBeCloseTo(195, 5);
  });

  it("paces to the next-stop ETA instead of outrunning it", () => {
    // Train doing 20 m/s but the ETA implies 1000m/100s = 10 m/s → paced.
    const v = vehicle({
      nextStopTimeOffset: 100,
      nextStopLon: -122.33,
      nextStopLat: 47.61 + 1000 / 111_000, // 1000m due north
    });
    expect(predictMeters(v, moving(20))).toBeCloseTo(10 * 15, 0);
  });

  it("stops short of the platform until a fix confirms arrival", () => {
    // 200m out, 10s to arrival: full speed would overshoot — capped at 85%.
    const v = vehicle({
      nextStopTimeOffset: 10,
      nextStopLon: -122.33,
      nextStopLat: 47.61 + 200 / 111_000,
    });
    expect(predictMeters(v, moving(20))).toBeCloseTo(0.85 * 200, 0);
  });

  it("caps a runaway speed at the absolute ceiling", () => {
    expect(predictMeters(vehicle(), moving(500))).toBe(1200);
  });
});
