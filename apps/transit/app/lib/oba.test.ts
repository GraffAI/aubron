import { describe, expect, it } from "vitest";

import { dedupeStops } from "./oba";

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
