import { describe, expect, it } from "vitest";
import {
  AnkerError,
  AuthError,
  PrinterNotFoundError,
  TimeoutError,
  TransportUnavailableError,
  toAnkerError,
} from "./errors.js";

describe("typed errors → exit codes", () => {
  it("maps each error to its documented exit code", () => {
    expect(new AuthError({ message: "x" }).exitCode).toBe(3);
    expect(new PrinterNotFoundError({ message: "x" }).exitCode).toBe(4);
    expect(new TimeoutError({ message: "x" }).exitCode).toBe(5);
    expect(new TransportUnavailableError({ message: "x" }).exitCode).toBe(6);
  });

  it("TimeoutError is always retriable", () => {
    expect(new TimeoutError({ message: "no response" }).retriable).toBe(true);
  });
});

describe("structured body (§3)", () => {
  it("emits code/transport/retriable/hint/input and echoes failing input", () => {
    const err = new TransportUnavailableError({
      message: "Printer USPRAKM-000994-YYLLG not found on local network",
      transport: "pppp",
      hint: "Run `ankerts discover --store` while on the same LAN, then retry.",
    }).withInput({ command: "print", file: "tower.gcode" });

    expect(err.toJSON()).toEqual({
      error: {
        code: "transport_unavailable",
        message: "Printer USPRAKM-000994-YYLLG not found on local network",
        transport: "pppp",
        retriable: false,
        hint: "Run `ankerts discover --store` while on the same LAN, then retry.",
        input: { command: "print", file: "tower.gcode" },
      },
    });
  });
});

describe("toAnkerError", () => {
  it("passes AnkerError through and wraps unknowns as exit 1", () => {
    const e = new AuthError({ message: "x" });
    expect(toAnkerError(e)).toBe(e);
    const wrapped = toAnkerError(new Error("boom"));
    expect(wrapped).toBeInstanceOf(AnkerError);
    expect(wrapped.exitCode).toBe(1);
    expect(wrapped.code).toBe("internal_error");
  });
});
