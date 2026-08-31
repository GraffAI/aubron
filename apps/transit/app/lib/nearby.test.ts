import { describe, expect, it } from "vitest";

import { nearbyRoutes, nearestStopsOnLine, type NearbyStop } from "./nearby";
import type { RouteInfo, StopInfo } from "./transit";

const route = (id: string, shortName: string, mode: RouteInfo["mode"]): RouteInfo => ({
  id,
  shortName,
  longName: `${shortName} long`,
  mode,
});

const KNOWN = new Map<string, RouteInfo>([
  ["40_100479", route("40_100479", "1 Line", "light-rail")],
  ["40_550", route("40_550", "550", "bus")],
]);

// Downtown-ish origin; the stops below sit at increasing offsets north of it.
const ORIGIN = { lat: 47.6, lon: -122.33 };
const stop = (id: string, dLat: number, routeIds: string[]): NearbyStop => ({
  id,
  name: id,
  lat: ORIGIN.lat + dLat,
  lon: ORIGIN.lon,
  routeIds,
});

describe("nearbyRoutes", () => {
  it("keeps the nearest stop for each route", () => {
    const out = nearbyRoutes(
      [stop("far", 0.01, ["40_550"]), stop("near", 0.001, ["40_550"])],
      ORIGIN,
      KNOWN,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.nearestStop.id).toBe("near");
    expect(out[0]!.distanceMeters).toBeCloseTo(111, -1);
  });

  it("drops routes outside the app's catalog", () => {
    const out = nearbyRoutes(
      [stop("a", 0.0005, ["1_100512", "40_550"]), stop("b", 0.0005, ["29_701"])],
      ORIGIN,
      KNOWN,
    );
    expect(out.map((r) => r.route.id)).toEqual(["40_550"]);
  });

  it("sorts by distance, rail and bus mixed", () => {
    const out = nearbyRoutes(
      [stop("bus-stop", 0.0008, ["40_550"]), stop("station", 0.004, ["40_100479"])],
      ORIGIN,
      KNOWN,
    );
    expect(out.map((r) => r.route.shortName)).toEqual(["550", "1 Line"]);
    expect(out[0]!.distanceMeters).toBeLessThan(out[1]!.distanceMeters);
  });

  it("returns nothing when no stop serves a known route", () => {
    expect(nearbyRoutes([stop("x", 0.0005, ["1_100512"])], ORIGIN, KNOWN)).toEqual([]);
    expect(nearbyRoutes([], ORIGIN, KNOWN)).toEqual([]);
  });
});

describe("nearestStopsOnLine", () => {
  const stops: StopInfo[] = [
    { id: "c", name: "C", lon: -122.33, lat: 47.63 },
    { id: "a", name: "A", lon: -122.33, lat: 47.601 },
    { id: "b", name: "B", lon: -122.33, lat: 47.61 },
    { id: "d", name: "D", lon: -122.33, lat: 47.64 },
  ];

  it("sorts ascending and caps at the limit", () => {
    const out = nearestStopsOnLine(stops, ORIGIN, 3);
    expect(out.map((s) => s.stop.id)).toEqual(["a", "b", "c"]);
    expect(out[0]!.distanceMeters).toBeLessThan(out[1]!.distanceMeters);
  });

  it("defaults to three and handles a short line", () => {
    expect(nearestStopsOnLine(stops, ORIGIN)).toHaveLength(3);
    expect(nearestStopsOnLine(stops.slice(0, 2), ORIGIN)).toHaveLength(2);
    expect(nearestStopsOnLine(stops, ORIGIN, 0)).toEqual([]);
  });
});
