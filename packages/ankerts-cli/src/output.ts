/**
 * Output framework — the heart of the agent-first conventions (brief §3).
 *
 * Rules enforced here:
 *  - Data → stdout. Logs, progress, diagnostics, errors → stderr. Always.
 *  - `--output json|ndjson|text`; default json when stdout is not a TTY, text
 *    when it is. `ANKER_OUTPUT` env honored. `--json` is an alias.
 *  - No ANSI when not a TTY, when NO_COLOR is set, or in json/ndjson mode.
 *  - `--quiet`: bare values, one per line, for `$()` capture and xargs.
 *  - `--fields a,b.c`: field mask to trim large objects (protects context).
 *  - Streaming commands emit NDJSON (one object per line, unbuffered) on stdout;
 *    their progress ticks go to stderr.
 */

export type OutputMode = "json" | "ndjson" | "text";

export interface OutputOptions {
  mode?: OutputMode;
  quiet?: boolean;
  fields?: string[];
  /** Stream sinks (injectable for tests). */
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  /** Whether stdout is a TTY (drives default mode + color). */
  isTty?: boolean;
  noColor?: boolean;
}

/** Resolve the effective output mode from flags + env + TTY. */
export function resolveMode(opts: {
  flag?: string;
  json?: boolean;
  env?: string;
  isTty: boolean;
}): OutputMode {
  const pick = (v?: string): OutputMode | undefined =>
    v === "json" || v === "ndjson" || v === "text" ? v : undefined;
  if (opts.json) return "json";
  return pick(opts.flag) ?? pick(opts.env) ?? (opts.isTty ? "text" : "json");
}

/** Project an object/array to the given dotted field paths. */
export function pickFields<T>(value: T, paths: string[]): unknown {
  if (paths.length === 0) return value;
  if (Array.isArray(value)) return value.map((v) => pickFields(v, paths));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const path of paths) {
    const segs = path.split(".");
    let src: unknown = value;
    for (const s of segs) {
      src = src && typeof src === "object" ? (src as Record<string, unknown>)[s] : undefined;
    }
    if (src !== undefined) out[path] = src;
  }
  return out;
}

function getPath(obj: unknown, path: string): unknown {
  let cur = obj;
  for (const s of path.split(".")) {
    cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[s] : undefined;
  }
  return cur;
}

function scalar(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export class Output {
  readonly mode: OutputMode;
  readonly quiet: boolean;
  readonly fields?: string[];
  private readonly out: (s: string) => void;
  private readonly err: (s: string) => void;
  readonly color: boolean;

  constructor(opts: OutputOptions = {}) {
    this.mode = opts.mode ?? "json";
    this.quiet = opts.quiet ?? false;
    this.fields = opts.fields;
    this.out = opts.stdout ?? ((s) => process.stdout.write(s));
    this.err = opts.stderr ?? ((s) => process.stderr.write(s));
    this.color = !!opts.isTty && !opts.noColor && this.mode === "text";
  }

  /** A diagnostic/progress line → stderr (never pollutes stdout). */
  log(message: string): void {
    this.err(`${message}\n`);
  }

  /** A single NDJSON object → stdout, newline-terminated (for streams). */
  ndjsonLine(obj: unknown): void {
    const masked = this.fields ? pickFields(obj, this.fields) : obj;
    this.out(`${JSON.stringify(masked)}\n`);
  }

  /**
   * Emit a command's primary result to stdout, honoring mode/quiet/fields.
   * `quietProjection` is the default field(s) printed in --quiet mode (e.g.
   * `["duid"]` so `printer list -q` yields bare DUIDs).
   */
  emit(value: unknown, opts: { quietProjection?: string[] } = {}): void {
    if (this.quiet) return this.emitQuiet(value, opts.quietProjection);
    const masked = this.fields ? pickFields(value, this.fields) : value;
    if (this.mode === "ndjson") {
      const arr = Array.isArray(masked) ? masked : [masked];
      for (const item of arr) this.out(`${JSON.stringify(item)}\n`);
      return;
    }
    if (this.mode === "json") {
      this.out(`${JSON.stringify(masked, null, 2)}\n`);
      return;
    }
    this.out(`${this.renderText(masked)}\n`);
  }

  private emitQuiet(value: unknown, projection?: string[]): void {
    const fields = this.fields ?? projection;
    const rows = Array.isArray(value) ? value : [value];
    for (const row of rows) {
      if (fields && fields.length && row && typeof row === "object") {
        this.out(`${fields.map((f) => scalar(getPath(row, f))).join("\t")}\n`);
      } else {
        this.out(`${scalar(row)}\n`);
      }
    }
  }

  /**
   * Emit a structured error (brief §3). In json/ndjson mode the `{ error: … }`
   * body goes to STDOUT so `… --json | jq '.error.hint'` works; in text mode a
   * readable rendering goes to STDERR. The exit code is set by the caller.
   */
  emitError(body: {
    error: {
      code: string;
      message: string;
      retriable: boolean;
      transport?: string;
      hint?: string;
      input?: Record<string, unknown>;
    };
  }): void {
    if (this.mode === "json") {
      this.out(`${JSON.stringify(body, null, 2)}\n`);
      return;
    }
    if (this.mode === "ndjson") {
      this.out(`${JSON.stringify(body)}\n`);
      return;
    }
    const e = body.error;
    const parts = [`error[${e.code}]: ${e.message}`];
    if (e.transport) parts.push(`  transport: ${String(e.transport)}`);
    parts.push(`  retriable: ${String(e.retriable)}`);
    if (e.hint) parts.push(`  hint: ${String(e.hint)}`);
    if (e.input) parts.push(`  input: ${JSON.stringify(e.input)}`);
    this.err(`${parts.join("\n")}\n`);
  }

  /** Best-effort human rendering for text mode. */
  private renderText(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (Array.isArray(value)) {
      return value.map((v) => this.renderText(v)).join("\n");
    }
    if (typeof value === "object") {
      return Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${typeof v === "object" && v ? JSON.stringify(v) : scalar(v)}`)
        .join("\n");
    }
    return scalar(value);
  }
}
