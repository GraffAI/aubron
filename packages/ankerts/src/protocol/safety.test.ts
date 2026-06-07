import { describe, expect, it } from "vitest";
import { inspectGcode } from "./safety.js";

describe("inspectGcode", () => {
  it("flags M900 as a volatile setter with a revert hint", () => {
    const i = inspectGcode("M900 K0.5");
    expect(i.code).toBe("M900");
    expect(i.mutatesState).toBe(true);
    expect(i.volatile).toBe(true);
    expect(i.note).toMatch(/M501 reverts/);
  });

  it("flags M500 as persistent", () => {
    const i = inspectGcode("M500");
    expect(i.persists).toBe(true);
    expect(i.volatile).toBe(false);
  });

  it("treats M501 as a revert (mutates, not volatile/persistent)", () => {
    const i = inspectGcode("M501");
    expect(i.mutatesState).toBe(true);
    expect(i.note).toMatch(/reloads settings from EEPROM/);
  });

  it("does not flag a read-only command", () => {
    const i = inspectGcode("M105");
    expect(i.mutatesState).toBe(false);
    expect(i.code).toBe("M105");
  });

  it("parses the leading code with arguments and comments", () => {
    expect(inspectGcode("  m851 Z-2.1 ; probe offset").code).toBe("M851");
  });
});
