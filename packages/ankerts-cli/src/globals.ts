/**
 * Global flags shared by every command (brief §3), plus argument parsing that
 * merges global + per-command flags and the documented exit-code contract.
 */
import { parseArgs } from "node:util";
import type { FlagSpec, GlobalFlags, ParsedArgs } from "./spec.js";

export const GLOBAL_FLAGS: FlagSpec[] = [
  {
    name: "output",
    type: "string",
    description: "Output format: json | ndjson | text. Default: json when piped, text on a TTY.",
  },
  { name: "json", type: "boolean", description: "Alias for --output json." },
  {
    name: "quiet",
    type: "boolean",
    short: "q",
    description: "Bare values, one per line — for $() capture and xargs.",
  },
  {
    name: "fields",
    type: "string",
    description: "Comma-separated field mask (dotted paths) to trim large objects.",
  },
  { name: "dry-run", type: "boolean", description: "Validate and report; mutate nothing." },
  { name: "yes", type: "boolean", description: "Bypass confirmations / safety warnings." },
  {
    name: "printer",
    type: "string",
    description: "Target printer by DUID, serial, name, or index. Default: selected printer.",
  },
  { name: "timeout", type: "string", description: "Override the command timeout, in seconds." },
  { name: "no-input", type: "boolean", description: "Never prompt; fail fast instead." },
  { name: "insecure", type: "boolean", description: "Disable TLS verification (testing only)." },
  { name: "help", type: "boolean", short: "h", description: "Show help for this command." },
];

/** The documented exit-code contract (printed in --help). */
export const EXIT_CODES: Record<number, string> = {
  0: "success",
  1: "generic / unexpected failure",
  2: "usage error (bad/missing args)",
  3: "auth error (login required/expired/captcha)",
  4: "printer not found / not selected",
  5: "connectivity/timeout — RETRIABLE",
  6: "transport unavailable for this op (e.g. upload needs LAN)",
  7: "printer-side error (gcode rejected, job refused)",
};

type ParseArgsConfig = Parameters<typeof parseArgs>[0];
type ParseArgsOptions = NonNullable<ParseArgsConfig>["options"];

/** Convert FlagSpecs into a node:util parseArgs options object. */
export function buildParseOptions(flags: FlagSpec[]): ParseArgsOptions {
  const options: NonNullable<ParseArgsOptions> = {};
  for (const f of flags) {
    // number flags are parsed as strings and converted later.
    options[f.name] = {
      type: f.type === "boolean" ? "boolean" : "string",
      ...(f.short ? { short: f.short } : {}),
      ...(f.multiple ? { multiple: true } : {}),
    };
  }
  return options;
}

/** Parse argv against the merged global+command flag set. */
export function parseCommandArgs(argv: string[], flags: FlagSpec[]): ParsedArgs {
  const all = [
    ...GLOBAL_FLAGS,
    ...flags.filter((f) => !GLOBAL_FLAGS.some((g) => g.name === f.name)),
  ];
  const numberFlags = new Set(all.filter((f) => f.type === "number").map((f) => f.name));
  const { values, positionals } = parseArgs({
    args: argv,
    options: buildParseOptions(all),
    allowPositionals: true,
    strict: true,
  });
  const out: Record<string, string | boolean | number | string[]> = {};
  for (const [k, v] of Object.entries(values)) {
    out[k] = numberFlags.has(k) && typeof v === "string" ? Number(v) : (v as never);
  }
  return { values: out, positionals };
}

/** Extract the cross-cutting global flags from a parsed values map. */
export function extractGlobals(values: ParsedArgs["values"]): GlobalFlags {
  const fields =
    typeof values.fields === "string" ? values.fields.split(",").map((s) => s.trim()) : undefined;
  return {
    output: typeof values.output === "string" ? values.output : undefined,
    json: values.json === true,
    quiet: values.quiet === true,
    fields,
    dryRun: values["dry-run"] === true,
    yes: values.yes === true,
    printer: typeof values.printer === "string" ? values.printer : undefined,
    timeout: typeof values.timeout === "string" ? Number(values.timeout) : undefined,
    noInput: values["no-input"] === true,
    reveal: values.reveal === true,
    insecure: values.insecure === true,
    help: values.help === true,
  };
}
