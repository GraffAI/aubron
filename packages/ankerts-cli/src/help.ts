/**
 * Help rendering — the agent's primary learning channel (brief §3). Every
 * command's help shows a summary, a longer description naming the transport, all
 * flags with types/defaults, the relevant exit codes, and worked examples with
 * sample output. Generated from {@link CommandSpec} so it never drifts.
 */
import { EXIT_CODES, GLOBAL_FLAGS } from "./globals.js";
import type { CommandSpec, FlagSpec } from "./spec.js";

const BIN = "ankerts";

const TRANSPORT_BLURB: Record<string, string> = {
  mqtt: "MQTT over TLS (Anker cloud broker) — works anywhere with internet + credentials.",
  pppp: "PPPP (P2P over UDP) — LAN only. Needs the printer's IP stored via discovery.",
  https: "HTTPS (Anker cloud API) — account auth and printer list; works anywhere.",
  none: "No printer transport (local/config operation).",
};

function flagUsage(f: FlagSpec): string {
  const dashName = f.name;
  const short = f.short ? `-${f.short}, ` : "";
  const valued = f.type === "boolean" ? "" : ` <${f.type}>`;
  const def = f.default !== undefined ? ` (default: ${String(f.default)})` : "";
  return `  ${short}--${dashName}${valued}\n      ${f.description}${def}`;
}

/** Render full help for one command. */
export function renderCommandHelp(spec: CommandSpec): string {
  const path = spec.path.join(" ");
  const argUsage = spec.args
    .map((a) =>
      a.required
        ? `<${a.name}${a.variadic ? "..." : ""}>`
        : `[${a.name}${a.variadic ? "..." : ""}]`,
    )
    .join(" ");
  const lines: string[] = [];

  lines.push(`${BIN} ${path} — ${spec.summary}`, "");
  lines.push("USAGE", `  ${BIN} ${path}${argUsage ? ` ${argUsage}` : ""} [flags]`, "");
  lines.push("DESCRIPTION", `  ${spec.description}`, "");
  lines.push("TRANSPORT", `  ${TRANSPORT_BLURB[spec.transport]}`, "");

  if (spec.args.length) {
    lines.push("ARGUMENTS");
    for (const a of spec.args) {
      lines.push(`  ${a.name}${a.variadic ? "..." : ""}    ${a.description}`);
    }
    lines.push("");
  }

  const cmdFlags = spec.flags.filter((f) => !GLOBAL_FLAGS.some((g) => g.name === f.name));
  if (cmdFlags.length) {
    lines.push("FLAGS");
    for (const f of cmdFlags) lines.push(flagUsage(f));
    lines.push("");
  }

  lines.push("GLOBAL FLAGS");
  for (const f of GLOBAL_FLAGS) lines.push(flagUsage(f));
  lines.push("");

  lines.push("EXIT CODES");
  for (const code of spec.exitCodes) lines.push(`  ${code}  ${EXIT_CODES[code] ?? ""}`);
  lines.push("");

  if (spec.examples.length) {
    lines.push("EXAMPLES");
    for (const ex of spec.examples) {
      if (ex.description) lines.push(`  # ${ex.description}`);
      lines.push(`  $ ${ex.cmd}`);
      if (ex.output) for (const o of ex.output.split("\n")) lines.push(`  ${o}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

/** Render the top-level help: noun groups + the CONCEPTS section (§3). */
export function renderRootHelp(specs: CommandSpec[]): string {
  const lines: string[] = [];
  lines.push(
    `${BIN} — agent-first CLI for AnkerMake / eufyMake M5 printers`,
    "",
    "USAGE",
    `  ${BIN} <noun> <verb> [args] [flags]`,
    "",
  );

  // Group commands by their leading noun.
  const groups = new Map<string, CommandSpec[]>();
  for (const s of specs) {
    const noun = s.path[0]!;
    (groups.get(noun) ?? groups.set(noun, []).get(noun)!).push(s);
  }
  lines.push("COMMANDS");
  for (const [noun, group] of groups) {
    lines.push(`  ${noun}`);
    for (const s of group) {
      lines.push(`    ${s.path.join(" ").padEnd(22)} ${s.summary}`);
    }
  }
  lines.push("");

  lines.push(
    "CONCEPTS",
    "  The M5 speaks THREE independent transports, split by reachability:",
    "    • MQTT over TLS  — gcode, status, control. Works ANYWHERE (internet + creds).",
    "    • PPPP over UDP  — file upload, camera. LAN ONLY; needs a discovered IP.",
    "    • HTTPS cloud    — login, account, printer list. Works anywhere.",
    "  Cloud-reachable ≠ LAN-reachable: gcode can work while upload (exit 6) cannot,",
    "  until you run `ankerts discover --store` on the same LAN as the printer.",
    "",
    "OUTPUT",
    "  Data → stdout; logs/progress → stderr. JSON by default when piped (text on a",
    "  TTY). Use --output, --quiet, and --fields to shape it. `ankerts describe --json`",
    "  dumps the entire command tree for one-call introspection.",
    "",
    `Run \`${BIN} <command> --help\` for details, transport, exit codes, and examples.`,
  );
  return lines.join("\n");
}
