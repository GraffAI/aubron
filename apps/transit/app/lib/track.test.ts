// TrackIndex on the REAL 1 Line geometry (an OBA polyline captured live) plus a
// synthetic right-angle track where the math has exact answers.

import { describe, expect, it } from "vitest";

import feed from "./__fixtures__/oba-feed.json";
import { bearing, TrackIndex } from "./track";
import { decodePolyline, type NetworkData } from "./transit";

const net = (shapes: NetworkData["shapes"]): NetworkData => ({
  routes: [],
  shapes,
  stops: [],
  busRoutes: [],
});

describe("decodePolyline (real 1 Line shape)", () => {
  const path = decodePolyline(feed.geometry.polyline);

  it("decodes to a plausible Puget Sound alignment", () => {
    expect(path.length).toBeGreaterThan(50);
    for (const [lon, lat] of path) {
      expect(lon).toBeGreaterThan(-123);
      expect(lon).toBeLessThan(-121.5);
      expect(lat).toBeGreaterThan(47);
      expect(lat).toBeLessThan(48.5);
    }
  });

  it("steps in small increments (no decode tears)", () => {
    for (let i = 1; i < path.length; i++) {
      const dLon = Math.abs(path[i]![0] - path[i - 1]![0]);
      const dLat = Math.abs(path[i]![1] - path[i - 1]![1]);
      // Consecutive shape points on a rail line sit well under ~3km apart.
      expect(dLon + dLat).toBeLessThan(0.03);
    }
  });
});

describe("TrackIndex (real 1 Line shape)", () => {
  const path = decodePolyline(feed.geometry.polyline);
  const track = new TrackIndex(net([{ routeId: "40_100479", shortName: "1 Line", path }]));

  it("snap → pointAt round-trips a vertex on the line", () => {
    const v = path[Math.floor(path.length / 2)]!;
    const c = track.snap("40_100479", v[0], v[1])!;
    expect(c).not.toBeNull();
    const [lon, lat] = track.pointAt("40_100479", c);
    expect(lon).toBeCloseTo(v[0], 6);
    expect(lat).toBeCloseTo(v[1], 6);
  });

  it("pulls a point offset from the line back onto it", () => {
    const v = path[Math.floor(path.length / 3)]!;
    // ~55m east of the track.
    const c = track.snap("40_100479", v[0] + 0.0007, v[1])!;
    const [lon, lat] = track.pointAt("40_100479", c);
    const offM = Math.hypot(
      (lon - v[0]) * 111_000 * Math.cos((v[1] * Math.PI) / 180),
      (lat - v[1]) * 111_000,
    );
    expect(offM).toBeLessThan(80); // snapped near the vertex, ON the line
  });

  it("distances grow monotonically along the shape", () => {
    let prev = -1;
    for (let i = 0; i < path.length; i += 7) {
      const d = track.snapToShape("40_100479", 0, path[i]![0], path[i]![1])!;
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
    expect(track.len("40_100479", 0)).toBeGreaterThan(1000); // a real line, in meters
  });

  it("returns null for a route it doesn't know", () => {
    expect(track.snap("nope", -122.3, 47.6)).toBeNull();
    expect(track.has("40_100479")).toBe(true);
    expect(track.has("nope")).toBe(false);
  });
});

describe("TrackIndex (synthetic right angle)", () => {
  // North 1110m, then east ~750m at this latitude.
  const path: [number, number][] = [
    [-122.3, 47.6],
    [-122.3, 47.61],
    [-122.29, 47.61],
  ];
  const track = new TrackIndex(net([{ routeId: "r", shortName: "x", path }]));

  it("measures cumulative meters through the corner", () => {
    const total = track.len("r", 0);
    const northLeg = 0.01 * 111_000; // 1110m
    const eastLeg = 0.01 * 111_000 * Math.cos((47.61 * Math.PI) / 180); // ~749m
    expect(total).toBeCloseTo(northLeg + eastLeg, -1);
  });

  it("pointAt walks around the corner, clamped at both ends", () => {
    const [lon0, lat0] = track.pointAt("r", { shape: 0, dist: -50 });
    expect([lon0, lat0]).toEqual([-122.3, 47.6]);
    const [lonMid, latMid] = track.pointAt("r", { shape: 0, dist: 555 });
    expect(lonMid).toBeCloseTo(-122.3, 9); // still on the north leg
    expect(latMid).toBeCloseTo(47.605, 4);
    const [lonEnd, latEnd] = track.pointAt("r", { shape: 0, dist: 1e9 });
    expect(lonEnd).toBeCloseTo(-122.29, 9);
    expect(latEnd).toBeCloseTo(47.61, 9);
  });

  it("bearingAt reads north on the first leg, east after the corner", () => {
    expect(track.bearingAt("r", { shape: 0, dist: 100 })).toBeCloseTo(0, 3);
    expect(track.bearingAt("r", { shape: 0, dist: 1500 })).toBeCloseTo(90, 3);
  });
});

describe("bearing", () => {
  it("matches the compass on the cardinal directions", () => {
    expect(bearing(-122.3, 47.6, -122.3, 47.7)).toBeCloseTo(0, 5);
    expect(bearing(-122.3, 47.6, -122.2, 47.6)).toBeCloseTo(90, 5);
    expect(bearing(-122.3, 47.6, -122.3, 47.5)).toBeCloseTo(180, 5);
    expect(bearing(-122.3, 47.6, -122.4, 47.6)).toBeCloseTo(270, 5);
  });
});
