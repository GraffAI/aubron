import { describe, expect, it } from "vitest";
import { Output, pickFields, resolveMode } from "./output.js";

function sink() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    opts: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) },
  };
}

describe("resolveMode", () => {
  it("defaults to json when piped, text on a TTY", () => {
    expect(resolveMode({ isTty: false })).toBe("json");
    expect(resolveMode({ isTty: true })).toBe("text");
  });
  it("honors --json, --output, and env precedence", () => {
    expect(resolveMode({ json: true, isTty: true })).toBe("json");
    expect(resolveMode({ flag: "ndjson", isTty: true })).toBe("ndjson");
    expect(resolveMode({ env: "json", isTty: true })).toBe("json");
  });
});

describe("pickFields", () => {
  it("projects dotted paths over objects and arrays", () => {
    expect(pickFields({ a: 1, b: { c: 2, d: 3 } }, ["a", "b.c"])).toEqual({ a: 1, "b.c": 2 });
    expect(
      pickFields(
        [
          { duid: "x", ip: "1" },
          { duid: "y", ip: "2" },
        ],
        ["duid"],
      ),
    ).toEqual([{ duid: "x" }, { duid: "y" }]);
  });
});

describe("Output.emit — data goes to stdout", () => {
  it("json mode pretty-prints", () => {
    const s = sink();
    new Output({ mode: "json", ...s.opts }).emit({ a: 1 });
    expect(s.out.join("")).toBe('{\n  "a": 1\n}\n');
    expect(s.err).toEqual([]);
  });

  it("ndjson mode prints one line per array element", () => {
    const s = sink();
    new Output({ mode: "ndjson", ...s.opts }).emit([{ a: 1 }, { a: 2 }]);
    expect(s.out).toEqual(['{"a":1}\n', '{"a":2}\n']);
  });

  it("quiet mode prints bare projected values (printer list -q → DUIDs)", () => {
    const s = sink();
    new Output({ mode: "json", quiet: true, ...s.opts }).emit(
      [{ duid: "USPRAKM-1" }, { duid: "USPRAKM-2" }],
      { quietProjection: ["duid"] },
    );
    expect(s.out).toEqual(["USPRAKM-1\n", "USPRAKM-2\n"]);
  });

  it("--fields trims the object", () => {
    const s = sink();
    new Output({ mode: "json", fields: ["nozzle.current"], ...s.opts }).emit({
      nozzle: { current: 224.94, target: 225 },
      bed: { current: 60 },
    });
    expect(JSON.parse(s.out.join(""))).toEqual({ "nozzle.current": 224.94 });
  });
});

describe("Output.emitError — stream placement (§3)", () => {
  it("json mode writes the error body to stdout (jq-friendly)", () => {
    const s = sink();
    new Output({ mode: "json", ...s.opts }).emitError({
      error: { code: "lan_printer_unreachable", message: "x", retriable: true, transport: "pppp" },
    });
    expect(JSON.parse(s.out.join("")).error.transport).toBe("pppp");
    expect(s.err).toEqual([]);
  });

  it("text mode writes a readable error to stderr", () => {
    const s = sink();
    new Output({ mode: "text", ...s.opts }).emitError({
      error: { code: "auth_required", message: "login required", retriable: false },
    });
    expect(s.out).toEqual([]);
    expect(s.err.join("")).toMatch(/error\[auth_required\]: login required/);
  });
});

describe("log goes to stderr", () => {
  it("never pollutes stdout", () => {
    const s = sink();
    new Output({ mode: "json", ...s.opts }).log("connecting…");
    expect(s.out).toEqual([]);
    expect(s.err).toEqual(["connecting…\n"]);
  });
});
