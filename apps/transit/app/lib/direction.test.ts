// The travel-direction lock. Measured live: ~8% of consecutive fixes move
// BACKWARDS along the trip (jitter/re-snaps) — an instantaneous heading flips
// on those and used to invert the train's arrow. Direction now comes from the
// station graph (the next stop) first, stays sticky through dwells, and only
// falls back to heading on first sighting.

import { describe, expect, it } from "vitest";

import { TrackIndex } from "./track";
import type { NetworkData, Vehicle } from "./transit";
import { travelDir } from "./useSmoothPositions";

// A straight north-south track, ~5.5km: dist 0 at the south end, growing north.
const path: [number, number][] = [
  [-122.3, 47.6],
  [-122.3, 47.65],
];
const net: NetworkData = {
  routes: [],
  shapes: [{ routeId: "r", shortName: "1 Line", path }],
  stops: [],
  busRoutes: [],
};
const track = new TrackIndex(net);

// A train mid-line (dist ≈ 2775m), by default heading north toward a stop well
// to the north.
const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
  id: "t",
  tripId: "t",
  routeId: "r",
  shortName: "1 Line",
  mode: "light-rail",
  lon: -122.3,
  lat: 47.625,
  heading: 0,
  deviation: 0,
  occupancy: "",
  predicted: true,
  headsign: "north",
  hasGps: true,
  nextStopLon: -122.3,
  nextStopLat: 47.64, // ~1.7km further north along the shape
  ...over,
});

const anchorOf = (v: Vehicle) => track.snap("r", v.lon, v.lat)!;

describe("travelDir", () => {
  it("reads +1 from a next stop further along the shape", () => {
    const v = vehicle();
    expect(travelDir(track, "r", anchorOf(v), v, undefined, 0)).toBe(1);
  });

  it("reads −1 from a next stop behind on the shape", () => {
    const v = vehicle({ nextStopLat: 47.61, heading: 180 });
    expect(travelDir(track, "r", anchorOf(v), v, undefined, 180)).toBe(-1);
  });

  it("does NOT flip when a backwards fix inverts the measured heading (the arrow bug)", () => {
    // Fix jitter makes the measured heading read due south while the trip's
    // next stop is still north — the station graph wins, the arrow holds.
    const v = vehicle();
    expect(travelDir(track, "r", anchorOf(v), v, undefined, 180)).toBe(1);
    expect(travelDir(track, "r", anchorOf(v), v, -1, 180)).toBe(1);
  });

  it("stays sticky through a dwell (next stop on top of the train)", () => {
    // At the platform the next stop is <25m along the shape — no usable sign.
    const v = vehicle({ nextStopLat: 47.6251 });
    expect(travelDir(track, "r", anchorOf(v), v, -1, 0)).toBe(-1);
    expect(travelDir(track, "r", anchorOf(v), v, 1, 180)).toBe(1);
  });

  it("falls back to heading vs track bearing on first sighting", () => {
    const v = vehicle({ nextStopLon: undefined, nextStopLat: undefined });
    expect(travelDir(track, "r", anchorOf(v), v, undefined, 10)).toBe(1); // ~north
    expect(travelDir(track, "r", anchorOf(v), v, undefined, 170)).toBe(-1); // ~south
  });
});

describe("TrackIndex.pathBetween", () => {
  // Right angle: north leg then east leg (corner vertex at index 1).
  const corner = new TrackIndex({
    routes: [],
    stops: [],
    busRoutes: [],
    shapes: [
      {
        routeId: "c",
        shortName: "x",
        path: [
          [-122.3, 47.6],
          [-122.3, 47.61],
          [-122.29, 47.61],
        ],
      },
    ],
  });
  const northLeg = 0.01 * 111_000; // ≈1110m to the corner

  it("includes the corner vertex between two distances that straddle it", () => {
    const arc = corner.pathBetween("c", 0, 500, northLeg + 300);
    expect(arc.length).toBe(3);
    expect(arc[0]![1]).toBeCloseTo(47.6 + 0.5 / 111, 4); // start, mid north leg
    expect(arc[1]).toEqual([-122.3, 47.61]); // the corner
    expect(arc[2]![1]).toBeCloseTo(47.61, 6); // end, on the east leg
    expect(arc[2]![0]).toBeGreaterThan(-122.3);
  });

  it("reverses when asked b → a, so the arc reads in travel order", () => {
    const fwd = corner.pathBetween("c", 0, 500, northLeg + 300);
    const rev = corner.pathBetween("c", 0, northLeg + 300, 500);
    expect(rev).toEqual([...fwd].reverse());
  });

  it("clamps to the shape and handles a zero-length arc", () => {
    const arc = corner.pathBetween("c", 0, -100, -50);
    expect(arc[0]).toEqual([-122.3, 47.6]);
    expect(arc[arc.length - 1]).toEqual([-122.3, 47.6]);
  });

  it("returns [] for an unknown route", () => {
    expect(corner.pathBetween("nope", 0, 0, 100)).toEqual([]);
  });
});
