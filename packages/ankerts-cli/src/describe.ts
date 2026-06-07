/**
 * `describe` — machine-readable introspection of the whole command tree (§3).
 * Lets an agent map the tool's full surface (every command, flag, type, default,
 * exit code, example) in a single call instead of crawling --help pages.
 */
import { EXIT_CODES, GLOBAL_FLAGS } from "./globals.js";
import type { CommandSpec } from "./spec.js";

export function buildDescribeTree(specs: CommandSpec[]): unknown {
  return {
    name: "ankerts",
    summary: "Agent-first CLI for AnkerMake / eufyMake M5 printers.",
    transports: {
      mqtt: { use: "gcode, status, control", reachability: "anywhere (internet + creds)" },
      pppp: { use: "file upload, camera", reachability: "LAN only (needs discovered IP)" },
      https: { use: "login, account, printer list", reachability: "anywhere" },
    },
    exitCodes: Object.fromEntries(Object.entries(EXIT_CODES).map(([k, v]) => [Number(k), v])),
    globalFlags: GLOBAL_FLAGS,
    commands: specs.map((s) => ({
      path: s.path,
      command: s.path.join(" "),
      summary: s.summary,
      description: s.description,
      transport: s.transport,
      args: s.args,
      flags: s.flags,
      exitCodes: s.exitCodes,
      examples: s.examples,
    })),
  };
}
