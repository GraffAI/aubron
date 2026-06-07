import { describe, expect, it } from "vitest";
import { greet, run } from "./index.js";

describe("greet", () => {
  it("greets the world by default", () => {
    expect(greet()).toBe("Hello, world!");
  });

  it("greets a given name", () => {
    expect(greet("Ada")).toBe("Hello, Ada!");
  });

  it("shouts when asked", () => {
    expect(greet("Ada", true)).toBe("HELLO, ADA!");
  });
});

describe("run", () => {
  it("defaults to greeting the world", () => {
    expect(run([])).toBe("Hello, world!");
  });

  it("parses a positional name and --shout", () => {
    expect(run(["Ada", "--shout"])).toBe("HELLO, ADA!");
  });
});
