import { describe, expect, it } from "vitest";

import { dedupeStops, nearbyStopsFromResponse } from "./oba";

// Shapes from the real feed prove the parent linkage; here we mirror its structure:
// a parent stop (parent: "") plus child platforms that point back to it.
describe("dedupeStops", () => {
  it("collapses a parent + its -T platforms into one station", () => {
    const out = dedupeStops([
      { id: "40_E11", name: "East Main", lon: -122.19115, lat: 47.60819, parent: "" },
      { id: "40_E11-T1", name: "East Main", lon: -122.1912, lat: 47.60771, parent: "40_E11" },
      { id: "40_E11", name: "East Main", lon: -122.19115, lat: 47.60819, parent: "" }, // dup parent
      { id: "40_E11-T2", name: "East Main", lon: -122.1911, lat: 47.6084, parent: "40_E11" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("40_E11");
    expect(out[0]!.name).toBe("East Main");
    expect(out[0]!.stopIds).toEqual(["40_E11-T1", "40_E11-T2"]);
  });

  it("groups numeric children by parent even when ids don't share a prefix", () => {
    const out = dedupeStops([
      { id: "40_C03", name: "Westlake", lon: -122.337, lat: 47.611, parent: "" },
      { id: "40_1108", name: "Westlake", lon: -122.3372, lat: 47.6112, parent: "40_C03" },
      { id: "40_1121", name: "Westlake", lon: -122.3368, lat: 47.6108, parent: "40_C03" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("40_C03");
    expect(out[0]!.stopIds).toEqual(["40_1108", "40_1121"]);
  });

  it("leaves a plain stop alone, querying itself", () => {
    const out = dedupeStops([
      { id: "40_999", name: "Somewhere", lon: -122.3, lat: 47.6, parent: "" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.stopIds).toEqual(["40_999"]);
  });

  it("snaps the merged point onto the line when shapes are given", () => {
    const shapes = [
      {
        routeId: "r",
        shortName: "1 Line",
        path: [
          [-122.2, 47.6],
          [-122.18, 47.6],
        ] as [number, number][],
      },
    ];
    // Parent sits just north of an east-west line; snapping should pull lat to ~47.6.
    const out = dedupeStops(
      [
        { id: "P", name: "Stn", lon: -122.19, lat: 47.6005, parent: "" },
        { id: "P-T1", name: "Stn", lon: -122.19, lat: 47.601, parent: "P" },
      ],
      shapes,
    );
    expect(out[0]!.lat).toBeCloseTo(47.6, 4);
    expect(out[0]!.lon).toBeCloseTo(-122.19, 4);
  });
});

// Shaped like a real stops-for-location payload: stops carry their own routeIds
// (across agencies), and route metadata rides along in references.
describe("nearbyStopsFromResponse", () => {
  const payload = {
    list: [
      {
        id: "40_990005",
        name: "Westlake Station",
        lat: 47.61152,
        lon: -122.33726,
        routeIds: ["40_100479", "1_100512"],
        direction: "N",
      },
      {
        id: "1_577",
        name: "3rd Ave & Pine St",
        lat: 47.6112,
        lon: -122.3381,
        routeIds: ["1_100512"],
        direction: "",
      },
      { id: "40_1234", name: "No routes listed", lat: 47.61, lon: -122.33 },
    ],
    references: {
      routes: [
        { id: "40_100479", shortName: "1 Line", longName: "Link", type: 0, color: "00A94F" },
        { id: "1_100512", shortName: "", longName: "Link light rail", type: 0, color: "" },
      ],
    },
  };

  it("maps stops with their routeIds and drops an empty direction", () => {
    const { stops } = nearbyStopsFromResponse(payload);
    expect(stops).toHaveLength(3);
    expect(stops[0]!.routeIds).toEqual(["40_100479", "1_100512"]);
    expect(stops[0]!.direction).toBe("N");
    expect(stops[1]!.direction).toBeUndefined();
    expect(stops[2]!.routeIds).toEqual([]);
  });

  it("builds route metadata with mode and color", () => {
    const { routes } = nearbyStopsFromResponse(payload);
    expect(routes[0]).toMatchObject({ shortName: "1 Line", mode: "light-rail", color: "00A94F" });
    // An empty shortName falls back to the long name, and "" is not a color.
    expect(routes[1]!.shortName).toBe("Link light rail");
    expect(routes[1]!.color).toBeUndefined();
  });

  it("survives a payload with nothing in it", () => {
    expect(nearbyStopsFromResponse({ list: [] })).toEqual({ stops: [], routes: [] });
  });
});
