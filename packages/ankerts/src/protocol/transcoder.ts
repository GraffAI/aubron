/**
 * Gcode metadata transcoder (brief §4A, optional `print --fix-metadata`).
 *
 * Third-party slicers (OrcaSlicer/PrusaSlicer) print correctly on the M5, but
 * the firmware's headline ETA/filament display reads from Anker-proprietary
 * header comments those slicers don't emit. AnkerMake Studio is Cura-based and
 * writes a `;TIME:<seconds>s` header; OrcaSlicer writes a human-readable
 * `; estimated printing time (normal mode) = 1h 39m 52s` instead.
 *
 * This is a TRANSCODER, not a calculator: the slicer already embedded its own
 * estimate; we only rewrite it into the keys/units Anker firmware reads. Motion,
 * temps, and `M73` progress are left untouched (they already work cross-slicer).
 * We never mutate the user's file — callers transcode a copy in the upload path.
 */

export interface TranscodeResult {
  /** The (possibly) rewritten gcode. */
  content: string;
  /** True if any Anker header line was injected. */
  changed: boolean;
  /** What was transcoded (for logging/reporting). */
  injected: {
    timeSeconds?: number;
    filamentMm?: number;
    filamentGrams?: number;
  };
}

/** Parse a duration like `1d 2h 39m 52s` / `1h 39m 52s` / `99m` into seconds. */
export function parseDurationToSeconds(text: string): number | undefined {
  let total = 0;
  let any = false;
  for (const [, value, unit] of text.matchAll(/(\d+(?:\.\d+)?)\s*([dhms])/gi)) {
    const n = Number(value);
    if (Number.isNaN(n)) continue;
    any = true;
    total += n * { d: 86400, h: 3600, m: 60, s: 1 }[unit!.toLowerCase() as "d" | "h" | "m" | "s"];
  }
  return any ? Math.round(total) : undefined;
}

/** Heuristic slicer detection from header comments. */
export function detectSlicer(gcode: string): "ankermake" | "orca" | "prusa" | "unknown" {
  const head = gcode.slice(0, 4096).toLowerCase();
  if (/;time:\s*\d/.test(head) || head.includes("ankermake") || head.includes("eufymake")) {
    return "ankermake";
  }
  if (head.includes("orcaslicer") || head.includes("orca_slicer")) return "orca";
  if (head.includes("prusaslicer")) return "prusa";
  // Fall back to the Orca/Prusa-style estimate comment.
  if (/estimated printing time/.test(head)) return "orca";
  return "unknown";
}

/** True when the firmware would already read a correct headline ETA. */
export function hasAnkerTimeHeader(gcode: string): boolean {
  return /^;TIME:\s*\d+/m.test(gcode);
}

function findNumber(gcode: string, re: RegExp): number | undefined {
  const m = re.exec(gcode);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Transcode a third-party slicer's embedded estimates into Anker/Cura header
 * comments. No-op (returns the input unchanged) when the file already carries a
 * `;TIME:` header — i.e. it was sliced natively.
 */
export function transcodeMetadata(gcode: string): TranscodeResult {
  if (hasAnkerTimeHeader(gcode)) {
    return { content: gcode, changed: false, injected: {} };
  }

  const injected: TranscodeResult["injected"] = {};
  const headerLines: string[] = [];

  const timeMatch = /;\s*estimated printing time \(normal mode\)\s*=\s*(.+)/i.exec(gcode);
  if (timeMatch) {
    const seconds = parseDurationToSeconds(timeMatch[1]!);
    if (seconds !== undefined) {
      injected.timeSeconds = seconds;
      headerLines.push(`;TIME:${seconds}s`);
    }
  }

  const mm = findNumber(gcode, /;\s*filament used \[mm\]\s*=\s*([\d.]+)/i);
  if (mm !== undefined) {
    injected.filamentMm = mm;
    headerLines.push(`;Filament used: ${mm}mm`);
  }

  const grams = findNumber(gcode, /;\s*total filament used \[g\]\s*=\s*([\d.]+)/i);
  if (grams !== undefined) {
    injected.filamentGrams = grams;
    headerLines.push(`;Filament weight: ${grams}g`);
  }

  if (headerLines.length === 0) {
    return { content: gcode, changed: false, injected };
  }

  // Cura/Anker writes these at the very top of the file.
  const content = `${headerLines.join("\n")}\n${gcode}`;
  return { content, changed: true, injected };
}
