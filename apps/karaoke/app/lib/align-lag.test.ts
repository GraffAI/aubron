import { describe, expect, it } from "vitest";

import { estimateLag } from "./align-lag";

/** Deterministic pseudo-noise (no seeded RNG needed). */
function noise(n: number): Float32Array {
  const out = new Float32Array(n);
  let x = 1234567;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (x / 0x3fffffff - 1) * 0.5;
  }
  return out;
}

describe("estimateLag", () => {
  const rate = 5512;

  it("recovers a known delay (mp3-encoder-sized)", () => {
    const base = noise(rate * 8);
    const delaySamples = Math.round(0.03 * rate); // 30ms, typical codec delay
    const late = new Float32Array(base.length);
    late.set(base.subarray(0, base.length - delaySamples), delaySamples);
    const lag = estimateLag(base, late, rate);
    expect(lag).not.toBeNull();
    expect(lag!).toBeCloseTo(0.03, 2);
  });

  it("recovers a negative delay (b earlier than a)", () => {
    const base = noise(rate * 8);
    const early = new Float32Array(base.length);
    early.set(base.subarray(Math.round(0.02 * rate)));
    const lag = estimateLag(base, early, rate);
    expect(lag).not.toBeNull();
    expect(lag!).toBeCloseTo(-0.02, 2);
  });

  it("reports ~zero for aligned signals", () => {
    const base = noise(rate * 6);
    const lag = estimateLag(base, base, rate);
    expect(lag).not.toBeNull();
    expect(Math.abs(lag!)).toBeLessThan(0.002);
  });

  it("refuses to guess for unrelated signals", () => {
    const a = noise(rate * 6);
    const b = new Float32Array(rate * 6);
    for (let i = 0; i < b.length; i++) b[i] = Math.sin(i / 7) * 0.4;
    expect(estimateLag(a, b, rate)).toBeNull();
  });

  it("refuses on silence and tiny windows", () => {
    expect(estimateLag(new Float32Array(rate * 4), noise(rate * 4), rate)).toBeNull();
    expect(estimateLag(noise(100), noise(100), rate)).toBeNull();
  });
});
