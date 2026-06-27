import { describe, expect, it } from "vitest";

import { resolveCode, resolveTeam } from "./teams.js";

describe("resolveTeam", () => {
  it("resolves by FIFA code", () => {
    expect(resolveTeam({ code: "BRA", name: "Brazil" }).name).toBe("Brazil");
  });

  it("resolves by country name when no code is given (api-football case)", () => {
    expect(resolveCode({ name: "France" })).toBe("FRA");
  });

  it("folds aliases and diacritics", () => {
    expect(resolveCode({ name: "Korea Republic" })).toBe("KOR");
    expect(resolveCode({ name: "United States" })).toBe("USA");
    expect(resolveCode({ name: "Türkiye" })).toBe("TUR");
  });

  it("falls back to a 3-letter code and neutral colours for unknown teams", () => {
    const t = resolveTeam({ name: "Atlantis" });
    expect(t.code).toBe("ATL");
    expect(t.primary).toHaveLength(3);
  });
});
