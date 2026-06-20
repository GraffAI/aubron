import { describe, expect, it } from "vitest";

import { boundsOfPaths, boundsOfPoints, fitBounds, padBounds } from "./camera";

describe("bounds", () => {
  it("spans a set of points", () => {
    const b = boundsOfPoints([
      [-122.3, 47.6],
      [-122.1, 47.8],
      [-122.5, 47.5],
    ]);
    expect(b).toEqual({ minLng: -122.5, minLat: 47.5, maxLng: -122.1, maxLat: 47.8 });
  });

  it("returns null for no points", () => {
    expect(boundsOfPoints([])).toBeNull();
    expect(boundsOfPaths([])).toBeNull();
  });

  it("walks every vertex of every path", () => {
    const b = boundsOfPaths([
      [
        [-122.3, 47.6],
        [-122.2, 47.65],
      ],
      [[-122.4, 47.55]],
    ]);
    expect(b).toEqual({ minLng: -122.4, minLat: 47.55, maxLng: -122.2, maxLat: 47.65 });
  });

  it("grows a zero-area box to at least the floor", () => {
    const b = padBounds({ minLng: -122, minLat: 47, maxLng: -122, maxLat: 47 }, 0.15, 0.004);
    expect(b.maxLng - b.minLng).toBeCloseTo(0.008, 6);
    expect(b.maxLat - b.minLat).toBeCloseTo(0.008, 6);
  });
});

describe("fitBounds", () => {
  it("centers on the box and zooms in further for a tighter box", () => {
    const wide = fitBounds(
      { minLng: -122.6, minLat: 47.4, maxLng: -122.0, maxLat: 47.9 },
      1200,
      800,
    );
    const tight = fitBounds(
      { minLng: -122.34, minLat: 47.6, maxLng: -122.32, maxLat: 47.62 },
      1200,
      800,
    );
    expect(wide.longitude).toBeCloseTo(-122.3, 1);
    expect(tight.zoom).toBeGreaterThan(wide.zoom);
  });

  it("never exceeds maxZoom for a single point", () => {
    const v = fitBounds(
      { minLng: -122.33, minLat: 47.61, maxLng: -122.33, maxLat: 47.61 },
      1200,
      800,
      { maxZoom: 14 },
    );
    expect(v.zoom).toBeLessThanOrEqual(14);
  });
});
