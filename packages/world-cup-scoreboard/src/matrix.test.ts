import { describe, expect, it } from "vitest";

import { buildPixelOrder, serializeFrame, type MatrixConfig } from "./matrix.js";

const base: MatrixConfig = {
  width: 2,
  height: 3,
  layout: "wled",
  serpentine: false,
  flipX: false,
  flipY: false,
};

describe("buildPixelOrder", () => {
  it("is identity for the wled layout (WLED's ledmap does the remap)", () => {
    expect([...buildPixelOrder(base)]).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("walks columns top-down then bottom-up for vertical serpentine (curtain wiring)", () => {
    // w=2,h=3: col0 → (0,0)(1,0)(2,0)=0,2,4 ; col1 reversed → (2,1)(1,1)(0,1)=5,3,1
    const order = buildPixelOrder({ ...base, layout: "vertical", serpentine: true });
    expect([...order]).toEqual([0, 2, 4, 5, 3, 1]);
  });

  it("reverses odd rows for horizontal serpentine", () => {
    // w=2,h=3: row0 → 0,1 ; row1 reversed → 3,2 ; row2 → 4,5
    const order = buildPixelOrder({ ...base, layout: "horizontal", serpentine: true });
    expect([...order]).toEqual([0, 1, 3, 2, 4, 5]);
  });

  it("honors flipX on a progressive horizontal panel", () => {
    const order = buildPixelOrder({ ...base, layout: "horizontal", flipX: true });
    expect([...order]).toEqual([1, 0, 3, 2, 5, 4]);
  });
});

describe("serializeFrame", () => {
  it("reorders pixels and applies brightness", () => {
    const rgb = new Uint8ClampedArray([10, 20, 30, 40, 50, 60]); // 2 pixels
    const order = Int32Array.from([1, 0]);
    expect([...serializeFrame(rgb, order, 0.5)]).toEqual([20, 25, 30, 5, 10, 15]);
  });
});
