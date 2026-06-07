import { describe, expect, it } from "vitest";
import { gcodeHasTerminalOk, parseGcodeResult, stripAnsi } from "./gcode.js";

const meta = { durationMs: 12, timedOut: false };

describe("stripAnsi", () => {
  it("removes SGR color codes", () => {
    expect(stripAnsi("[32mecho:Advance K=0.00[0m")).toBe("echo:Advance K=0.00");
  });
});

describe("parseGcodeResult — M115 (firmware info)", () => {
  // Observed M115 output: multiple KEY:VALUE pairs on one line + capabilities.
  const chunks = [
    "FIRMWARE_NAME:Marlin V8111_V3.2.2 (Sep 13 2023 10:00:00) " +
      "SOURCE_CODE_URL:github.com/ankermake PROTOCOL_VERSION:1.0 " +
      "MACHINE_TYPE:AnkerMake M5 EXTRUDER_COUNT:1 UUID:cafebabe\n",
    "Cap:EEPROM:1\nok\n",
  ];
  const r = parseGcodeResult("M115", chunks, meta);

  it("is recognized and terminates with ok", () => {
    expect(r.recognized).toBe(true);
    expect(r.ok).toBe(true);
  });

  it("captures the FULL firmware name (spaces and all)", () => {
    expect(r.fields.FIRMWARE_NAME).toBe("Marlin V8111_V3.2.2 (Sep 13 2023 10:00:00)");
  });

  it("captures EXTRUDER_COUNT", () => {
    expect(r.fields.EXTRUDER_COUNT).toBe("1");
  });
});

describe("parseGcodeResult — M900 (the echo:Ad truncation bug, §6)", () => {
  // The reference returned only the first frame: "echo:Ad". Here the full reply
  // arrives across THREE frames and must reassemble to the complete K value.
  const chunks = ["echo:Ad", "vance K=0", ".00\nok\n"];
  const r = parseGcodeResult("M900", chunks, meta);

  it("reassembles all frames into the complete field value", () => {
    expect(r.frames).toBe(3);
    expect(r.fields["Advance K"]).toBe("0.00");
  });

  it("is recognized", () => {
    expect(r.recognized).toBe(true);
  });
});

describe("parseGcodeResult — M9998 (bogus command)", () => {
  const r = parseGcodeResult("M9998", ['echo:Unknown command: "M9998"\nok\n'], meta);
  it("is not recognized", () => {
    expect(r.recognized).toBe(false);
  });
});

describe("parseGcodeResult — M503 (multi-frame settings dump)", () => {
  // Arrives across several frames; reports must be fully reassembled, not cut
  // at the first frame.
  const chunks = [
    "echo:  G21 ; Units in mm\necho:  M149 C\necho:  M200 S0 ",
    "D1.75\necho:  M92 X80.00 Y80.00 Z400.00 E417.00\n",
    "echo:  M301 P22.89 I1.85 D70.73\necho:  M851 X0.00 Y0.00 Z-2.10\n",
    "echo:  M900 K0.00\necho:  M906 X800 Y800 Z800 E1000\n",
    "echo:  M913 X0 Y0 Z0 E0\nok\n",
  ];
  const r = parseGcodeResult("M503", chunks, meta);

  it("reassembles many M-code reports across all frames", () => {
    expect(r.reports.M92).toBe("X80.00 Y80.00 Z400.00 E417.00");
    expect(r.reports.M301).toBe("P22.89 I1.85 D70.73");
    expect(r.reports.M851).toBe("X0.00 Y0.00 Z-2.10");
    expect(r.reports.M900).toBe("K0.00");
    expect(r.reports.M906).toBe("X800 Y800 Z800 E1000");
    expect(r.reports.M913).toBe("X0 Y0 Z0 E0");
  });

  it("did not get cut at one frame", () => {
    expect(r.frames).toBe(5);
    expect(r.ok).toBe(true);
  });
});

describe("gcodeHasTerminalOk", () => {
  it("detects a bare ok and an ok carrying data", () => {
    expect(gcodeHasTerminalOk("echo:busy\nok")).toBe(true);
    expect(gcodeHasTerminalOk("ok T:25.00 /0.0 B:24.00 /0.0")).toBe(true);
    expect(gcodeHasTerminalOk("echo:Advance K=0")).toBe(false);
  });
});

describe("timedOut is distinct from unrecognized", () => {
  it("reports a timeout without claiming the command was rejected", () => {
    const r = parseGcodeResult("M109 S200", ["echo:busy: processing\n"], {
      durationMs: 10000,
      timedOut: true,
    });
    expect(r.timedOut).toBe(true);
    expect(r.recognized).toBe(true);
    expect(r.ok).toBe(false);
  });
});
