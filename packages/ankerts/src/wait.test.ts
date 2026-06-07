import { describe, expect, it } from "vitest";
import type { PrinterStatus } from "./protocol/status.js";
import { conditionHolds, describeWaitCondition, parseWaitCondition } from "./wait.js";

const status = (over: Partial<PrinterStatus> = {}): PrinterStatus => ({
  nozzle: { current: 210, target: 210 },
  bed: { current: 60, target: 60 },
  raw: {},
  ...over,
});

describe("parseWaitCondition", () => {
  it("parses comparison and bare conditions", () => {
    expect(parseWaitCondition("nozzle>=210")).toEqual({ kind: "nozzle", atLeast: 210 });
    expect(parseWaitCondition("progress>=50")).toEqual({ kind: "progress", atLeast: 50 });
    expect(parseWaitCondition("complete")).toEqual({ kind: "complete" });
  });
  it("round-trips through describeWaitCondition", () => {
    expect(describeWaitCondition(parseWaitCondition("layer>=12"))).toBe("layer>=12");
  });
  it("rejects unknown conditions", () => {
    expect(() => parseWaitCondition("explode")).toThrow(/unknown wait condition/);
  });
});

describe("conditionHolds", () => {
  it("temperature thresholds", () => {
    expect(conditionHolds({ kind: "nozzle", atLeast: 200 }, status())).toBe(true);
    expect(conditionHolds({ kind: "nozzle", atLeast: 220 }, status())).toBe(false);
  });

  it("temp-stable requires being near target", () => {
    expect(conditionHolds({ kind: "temp-stable" }, status())).toBe(true);
    expect(
      conditionHolds({ kind: "temp-stable" }, status({ nozzle: { current: 150, target: 210 } })),
    ).toBe(false);
  });

  it("job-state conditions", () => {
    const printing = status({
      job: { name: "x", state: "printing", progressPct: 30, layer: 12, totalLayers: 100 },
    });
    expect(conditionHolds({ kind: "printing" }, printing)).toBe(true);
    expect(conditionHolds({ kind: "progress", atLeast: 25 }, printing)).toBe(true);
    expect(conditionHolds({ kind: "layer", atLeast: 20 }, printing)).toBe(false);
    expect(conditionHolds({ kind: "complete" }, printing)).toBe(false);
  });

  it("transport-only conditions return null", () => {
    expect(conditionHolds({ kind: "connected" }, status())).toBeNull();
    expect(conditionHolds({ kind: "lan" }, status())).toBeNull();
  });
});
