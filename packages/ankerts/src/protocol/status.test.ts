import { describe, expect, it } from "vitest";
import { normalizeStatus, type RawNotice } from "./status.js";

// Observed live during the tower print (§5). Temps in 1/100 °C, progress 1/100 %.
const nozzle: RawNotice = { commandType: 1003, currentTemp: 22494, targetTemp: 22500 };
const bed: RawNotice = { commandType: 1004, currentTemp: 6002, targetTemp: 6000 };
const layer: RawNotice = { commandType: 1052, total_layer: 450, real_print_layer: 94 };
const speed: RawNotice = { commandType: 1006, value: 60 };

describe("normalizeStatus — unit conversion (§5)", () => {
  const s = normalizeStatus([nozzle, bed, layer, speed]);
  it("converts 1/100 °C to °C", () => {
    expect(s.nozzle.current).toBe(224.94);
    expect(s.nozzle.target).toBe(225);
    expect(s.bed.current).toBe(60.02);
  });
});

describe("normalizeStatus — third-party gcode ETA (§4A)", () => {
  // The §4A tell: time (10060053) is wildly inconsistent with totalTime (1028).
  const orcaSchedule: RawNotice = {
    commandType: 1001,
    name: "tower.gcode",
    progress: 2099, // 20.99%
    time: 10060053,
    totalTime: 1028,
    startLeftTime: 72000000,
    filamentUsed: 5894.33,
    filamentUnit: "mm",
  };
  const s = normalizeStatus([nozzle, bed, layer, orcaSchedule]);

  it("reports sane progress and layer", () => {
    expect(s.job?.progressPct).toBeCloseTo(20.99, 2);
    expect(s.job?.totalLayers).toBe(450);
    expect(s.job?.layer).toBe(94);
  });

  it("does NOT surface the bogus ETA", () => {
    expect(s.job?.etaReliable).toBe(false);
    expect(s.job?.etaSeconds).toBeUndefined();
  });

  it("still reports state as printing", () => {
    expect(s.job?.state).toBe("printing");
  });
});

describe("normalizeStatus — native gcode ETA is trusted", () => {
  const nativeSchedule: RawNotice = {
    commandType: 1001,
    name: "native.gcode",
    progress: 5000,
    time: 4286,
    totalTime: 8573,
    startLeftTime: 4287,
  };
  const s = normalizeStatus([nativeSchedule]);
  it("keeps a consistent ETA", () => {
    expect(s.job?.etaReliable).toBe(true);
    expect(s.job?.etaSeconds).toBe(4287);
  });
});
