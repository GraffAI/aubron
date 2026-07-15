import { afterEach, describe, expect, it } from "vitest";

import { createSessionValue, isAuthEnabled, verifySessionValue } from "./auth";

afterEach(() => {
  delete process.env.KARAOKE_PASSCODE;
});

describe("session cookies", () => {
  it("auth is disabled without a passcode", () => {
    expect(isAuthEnabled()).toBe(false);
  });

  it("round-trips a signed session", async () => {
    process.env.KARAOKE_PASSCODE = "sing-it";
    const value = await createSessionValue();
    expect(await verifySessionValue(value)).toBe(true);
  });

  it("rejects tampered and expired values", async () => {
    process.env.KARAOKE_PASSCODE = "sing-it";
    const value = await createSessionValue();
    expect(await verifySessionValue(undefined)).toBe(false);
    expect(await verifySessionValue("garbage")).toBe(false);
    expect(await verifySessionValue(value.replace(/.$/, (c) => (c === "0" ? "1" : "0")))).toBe(
      false,
    );
    const expired = await createSessionValue(Date.now() - 40 * 24 * 60 * 60 * 1000);
    expect(await verifySessionValue(expired)).toBe(false);
  });

  it("invalidates sessions when the passcode rotates", async () => {
    process.env.KARAOKE_PASSCODE = "old-code";
    const value = await createSessionValue();
    process.env.KARAOKE_PASSCODE = "new-code";
    expect(await verifySessionValue(value)).toBe(false);
  });
});
