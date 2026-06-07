/**
 * Gcode request/response handling — the centerpiece of the SDK (brief §6).
 *
 * A single gcode command's textual output is delivered by the printer as one or
 * more MQTT reply frames, each carrying a chunk in `resData`. The reference
 * returned only the FIRST chunk, truncating multi-frame replies (the `echo:Ad`
 * bug). Here we concatenate every chunk in arrival order into the complete text,
 * strip ANSI, and parse it into a structured `GcodeResult` — callers never see a
 * partial line.
 *
 * This module is pure: the transport collects frames and decides completion
 * (terminal `ok` / quiet period / hard timeout); these functions turn the
 * collected chunks into a result. That keeps the parser fully unit-testable
 * against the observed fixtures.
 */

export interface GcodeResult {
  /** Echoed input command. */
  command: string;
  /** FULL reassembled text, ANSI-free, all frames concatenated in order. */
  raw: string;
  /** `raw` split on newlines, trimmed, with empty lines removed. */
  lines: string[];
  /** A terminal `ok` line was seen. */
  ok: boolean;
  /** False iff an `echo:Unknown command` line was seen. */
  recognized: boolean;
  /** Parsed `echo:Key=Value` / `Key:Value` pairs, e.g. `{ "Advance K": "0.00" }`. */
  fields: Record<string, string>;
  /** Parsed Marlin report lines keyed by code, e.g. `{ "M900": "K0.00" }`. */
  reports: Record<string, string>;
  /** Wall-clock time spent collecting the response. */
  durationMs: number;
  /** Completion signal never arrived within the timeout. */
  timedOut: boolean;
  /** How many MQTT frames were reassembled (diagnostic). */
  frames: number;
}

// ANSI escape sequences (CSI/SGR etc.). The ESC (0x1b) and single-byte CSI
// (0x9b) introducers are assembled via fromCharCode so no control byte lives in
// source (and no-control-regex stays quiet).
const ESC = String.fromCharCode(0x1b);
const CSI = String.fromCharCode(0x9b);
const ANSI_RE = new RegExp(
  `[${ESC}${CSI}][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-ntqry=><~]`,
  "g",
);

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** Concatenate reply chunks in arrival order; strip ANSI; normalize newlines. */
export function reassembleRaw(chunks: readonly string[]): string {
  return stripAnsi(chunks.join("")).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Split reassembled text into trimmed, non-empty lines. */
export function splitLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Does the reassembled text contain a terminal `ok`? Marlin terminates a
 * command's output with an `ok` line (sometimes carrying data, e.g. M105's
 * `ok T:...`). Used by the transport's completion detection.
 */
export function gcodeHasTerminalOk(raw: string): boolean {
  return splitLines(raw).some((l) => /^ok\b/i.test(l) || l.toLowerCase() === "ok");
}

/** Was an "unknown command" rejection seen? */
function hasUnknownCommand(lines: readonly string[]): boolean {
  return lines.some((l) => /echo:\s*Unknown command/i.test(l));
}

// A Marlin report line: a leading G/M code followed by its parameters.
const REPORT_RE = /^([GM]\d+)\b\s*(.*)$/;

/**
 * Extract `KEY:VALUE` tokens from an M115-style line where several pairs share
 * one line and values may contain spaces (e.g. `FIRMWARE_NAME:Marlin V8111 ...
 * EXTRUDER_COUNT:1`). Boundaries are a space immediately preceding an uppercase
 * token + colon.
 */
function parseKeyColonTokens(line: string, out: Record<string, string>): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*:/.test(line)) return false;
  // Split before ` UPPER_TOKEN:` boundaries, keeping each `KEY:VALUE` together.
  const parts = line.split(/\s+(?=[A-Z][A-Z0-9_]*:)/);
  let matched = false;
  for (const part of parts) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      out[key] = value;
      matched = true;
    }
  }
  return matched;
}

/**
 * Parse the collected reply chunks for one command into a complete GcodeResult.
 *
 * @param command  the gcode that was sent (echoed back)
 * @param chunks   `resData` strings from each reply frame, in arrival order
 * @param meta     timing/diagnostic info supplied by the transport
 */
export function parseGcodeResult(
  command: string,
  chunks: readonly string[],
  meta: { durationMs: number; timedOut: boolean },
): GcodeResult {
  const raw = reassembleRaw(chunks);
  const lines = splitLines(raw);
  const fields: Record<string, string> = {};
  const reports: Record<string, string> = {};

  for (const line of lines) {
    // Strip a leading `echo:` and any indentation Marlin adds inside reports.
    const body = line.replace(/^echo:\s*/i, "").trim();

    // 1. Report line: starts with a G/M code (e.g. `M900 K0.00`, M503 dumps).
    const report = REPORT_RE.exec(body);
    if (report && !body.includes("=")) {
      reports[report[1]!] = report[2]!.trim();
      continue;
    }

    // 2. `Key=Value` field (e.g. `Advance K=0.00`).
    if (body.includes("=") && !/^[A-Za-z_][A-Za-z0-9_]*:/.test(body)) {
      const eq = body.indexOf("=");
      const key = body.slice(0, eq).trim();
      const value = body.slice(eq + 1).trim();
      if (key) {
        fields[key] = value;
        continue;
      }
    }

    // 3. `KEY:VALUE` token(s) (e.g. M115's FIRMWARE_NAME / EXTRUDER_COUNT).
    parseKeyColonTokens(body, fields);
  }

  return {
    command,
    raw,
    lines,
    ok: gcodeHasTerminalOk(raw),
    recognized: !hasUnknownCommand(lines),
    fields,
    reports,
    durationMs: meta.durationMs,
    timedOut: meta.timedOut,
    frames: chunks.length,
  };
}
