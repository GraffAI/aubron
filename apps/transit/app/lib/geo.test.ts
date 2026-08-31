import { describe, expect, it } from "vitest";

import { formatWalk, haversineMeters, walkMinutes } from "./geo";

// Real Link stations — the distances are checkable against a map.
const WESTLAKE = { lat: 47.61152, lon: -122.33726 };
const UNIVERSITY_ST = { lat: 47.60717, lon: -122.33161 }; // Symphony, one stop south
const SEATAC = { lat: 47.44519, lon: -122.29695 };

describe("haversineMeters", () => {
  it("is zero for the same point", () => {
    expect(haversineMeters(WESTLAKE, WESTLAKE)).toBe(0);
  });

  it("matches a known short hop (Westlake → Symphony ≈ 660 m)", () => {
    expect(haversineMeters(WESTLAKE, UNIVERSITY_ST)).toBeGreaterThan(600);
    expect(haversineMeters(WESTLAKE, UNIVERSITY_ST)).toBeLessThan(720);
  });

  it("matches a known long hop (Westlake → SeaTac ≈ 18.9 km)", () => {
    expect(haversineMeters(WESTLAKE, SEATAC)).toBeCloseTo(18_900, -3);
  });

  it("is symmetric", () => {
    expect(haversineMeters(WESTLAKE, SEATAC)).toBeCloseTo(haversineMeters(SEATAC, WESTLAKE), 6);
  });
});

describe("walkMinutes", () => {
  it("rounds up at 80 m/min", () => {
    expect(walkMinutes(80)).toBe(1);
    expect(walkMinutes(81)).toBe(2);
    expect(walkMinutes(400)).toBe(5);
    expect(walkMinutes(401)).toBe(6);
  });

  it("never goes below one minute", () => {
    expect(walkMinutes(0)).toBe(1);
    expect(walkMinutes(-5)).toBe(1);
    expect(walkMinutes(12)).toBe(1);
  });
});

describe("formatWalk", () => {
  it("reads as walk minutes inside a half hour", () => {
    expect(formatWalk(20)).toBe("1 min walk");
    expect(formatWalk(320)).toBe("4 min walk");
    expect(formatWalk(2400)).toBe("30 min walk");
  });

  it("switches to distance beyond a half-hour walk", () => {
    expect(formatWalk(2401)).toBe("2.4 km");
    expect(formatWalk(18_900)).toBe("19 km");
  });
});
