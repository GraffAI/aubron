/**
 * Gcode request/response handling (brief §6).
 *
 * IMPORTANT — corrected against real M5 hardware (see the project memory). The
 * brief assumed a gcode reply arrives across multiple `0x0413` frames to be
 * reassembled. It does not: each send yields exactly ONE reply whose `resData`
 * is a point-in-time snapshot of the firmware's ~512-byte serial ring buffer,
 * and the snapshot is RACY. Short replies (M105) come back whole; replies that
 * exceed the window are capped at 512 bytes; and a reply caught mid-write
 * truncates early with a `+ringbuf:<a>,512,<b>` marker (the buffer reporting its
 * own state) — this is the real `echo:Ad` bug.
 *
 * So we still concatenate whatever chunks the transport collected, strip ANSI,
 * and parse — but the key honesty fix is `truncated`: rather than silently
 * handing back a partial line (as the reference did), we DETECT truncation and
 * flag it, so a caller never mistakes `echo:Ad` for a complete reply.
 *
 * This module is pure: the transport collects the reply and decides completion;
 * these functions turn the collected chunks into a result, keeping the parser
 * fully unit-testable against the observed captures.
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
  /**
   * The reply is incomplete: it hit the firmware's ~512-byte snapshot window, or
   * carries a `+ringbuf:` marker showing the serial buffer was mid-write. When
   * true, `raw`/`fields`/`reports` may be partial — do not trust them as the
   * full command output. (The reference silently returned these as if complete.)
   */
  truncated: boolean;
  /** How many reply chunks were collected (diagnostic; usually 1 — see header). */
  frames: number;
}

// The firmware's gcode reply is a snapshot of a ~512-byte serial ring buffer.
const GCODE_WINDOW_BYTES = 512;
const RINGBUF_RE = /\+ringbuf:\s*\d+,\s*\d+,\s*\d+/;

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
 * Does the reassembled text END with a terminal `ok`? Marlin terminates a
 * command's output with an `ok` line (sometimes carrying data, e.g. M105's
 * `ok T:...`). The check is on the LAST non-empty line, not any line: the M5
 * firmware emits a leading `ok` (and a double-`ok`) BEFORE the real output (e.g.
 * `ok\n\nok\n\n+ringbuf:...\necho:Advance K=0.00\nok`), so matching any `ok`
 * would stop reassembly early and truncate the reply — the `echo:Ad` bug. Used
 * by the transport's completion detection.
 */
export function gcodeHasTerminalOk(raw: string): boolean {
  // Ignore trailing firmware buffer-state noise (`+ringbuf:...` / a lone `+`)
  // that the M5 appends AFTER the terminal `ok`, which would otherwise hide it.
  const lines = splitLines(raw).filter((l) => !/^\+/.test(l));
  const last = lines[lines.length - 1];
  return last !== undefined && (/^ok\b/i.test(last) || last.toLowerCase() === "ok");
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

  // Truncation: a `+ringbuf:` marker (snapshot taken mid-write) or hitting the
  // ~512-byte window (more output existed than the snapshot could hold).
  const truncated = RINGBUF_RE.test(raw) || chunks.join("").length >= GCODE_WINDOW_BYTES;

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
    truncated,
    frames: chunks.length,
  };
}
