/**
 * Gcode commands: gcode (single / batch / stdin), state snapshot, state restore.
 */
import { readFile } from "node:fs/promises";
import { inspectGcode, type GcodeOptions } from "@aubron/ankerts";
import { defineCommand, type Context, type CommandSpec } from "../spec.js";
import { flagBool, flagStr, requirePositional, timeoutMs } from "../runtime.js";

/** Warn about state-mutating gcode on stderr unless suppressed (§4, lesson #5). */
function warnIfMutating(ctx: Context, command: string): void {
  if (ctx.globals.yes || ctx.globals.dryRun) return;
  const info = inspectGcode(command);
  if (info.mutatesState && info.note) ctx.out.log(`warning: ${info.note}`);
}

const gcode: CommandSpec = defineCommand({
  path: ["gcode"],
  summary: "Send gcode and return the COMPLETE reassembled, parsed response.",
  description:
    "Publishes gcode over MQTT and collects EVERY reply frame, concatenating them into " +
    "the full response before parsing — never returning a truncated line (the reference's " +
    "`echo:Ad` bug). The result carries raw text, parsed fields/reports, ok, recognized, " +
    "and timedOut (distinct from recognized:false — a timeout is not a rejection). " +
    "Accepts one command as args, many via --batch <file>, or `-` to read stdin " +
    "(one per line, NDJSON result per line). State-mutating commands print a volatility " +
    "warning on stderr unless --yes. Default timeouts are latency-class aware (M109/M190/" +
    "G29/M303 get minutes); --wait-motion appends M400 so the call returns on true motion " +
    "completion, not queue-accept.",
  transport: "mqtt",
  args: [
    {
      name: "CMD",
      description: "Gcode to send (or `-` to read commands from stdin).",
      variadic: true,
    },
  ],
  flags: [
    { name: "no-wait", type: "boolean", description: "Fire-and-forget; don't collect a response." },
    {
      name: "wait-motion",
      type: "boolean",
      description: "Append M400 — return on motion complete.",
    },
    { name: "batch", type: "string", description: "Read commands from a file (one per line)." },
  ],
  exitCodes: [0, 1, 3, 4, 5, 7],
  examples: [
    {
      description: "Read the full firmware string",
      cmd: "ankerts gcode M115 --json | jq -r '.fields.FIRMWARE_NAME'",
      output: "Marlin V8111_V3.2.2 (...)",
    },
    {
      description: "The bug that started this — the COMPLETE Linear Advance K",
      cmd: "ankerts gcode M900 --json | jq -r '.fields[\"Advance K\"]'",
      output: "0.00",
    },
    {
      description: "Detect an unknown command",
      cmd: "ankerts gcode M9998 --json | jq .recognized",
      output: "false",
    },
    {
      description: "Batch from stdin, one NDJSON result per line",
      cmd: "printf 'M104 S200\\nM140 S60\\n' | ankerts gcode -",
    },
  ],
  async run(ctx) {
    const client = ctx.client();
    const opts: GcodeOptions = {
      timeoutMs: timeoutMs(ctx, 0) || undefined,
      wait: !flagBool(ctx.args, "no-wait"),
      waitMotion: flagBool(ctx.args, "wait-motion"),
    };

    // Determine the command source: --batch file, stdin (`-`), or positionals.
    const batchFile = flagStr(ctx.args, "batch");
    let commands: string[];
    if (batchFile) {
      commands = (await readFile(batchFile, "utf8"))
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    } else if (ctx.args.positionals[0] === "-") {
      commands = (await ctx.readStdin())
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    } else {
      const single = ctx.args.positionals.join(" ").trim();
      if (!single) {
        requirePositional(ctx, 0, "CMD"); // throws a structured usage error
      }
      commands = [single];
    }

    if (ctx.globals.dryRun) {
      ctx.out.emit(
        commands.map((command) => ({ dryRun: true, command, inspect: inspectGcode(command) })),
      );
      return;
    }

    for (const command of commands) warnIfMutating(ctx, command);

    if (commands.length === 1) {
      const result = await client.gcode(commands[0]!, opts);
      await client.close();
      ctx.out.emit(result);
      return;
    }
    // Batch → one NDJSON result line per command, as each completes.
    for await (const result of client.gcodeBatch(commands, opts)) {
      ctx.out.ndjsonLine(result);
    }
    await client.close();
  },
});

const stateSnapshot: CommandSpec = defineCommand({
  path: ["state", "snapshot"],
  summary: "Capture machine settings (M503) as a parsed object.",
  description:
    "Sends M503 over MQTT and parses the multi-frame settings dump into a structured " +
    "object (linear advance K, hotend PID, steps/mm, probe Z offset, and the full report " +
    "map). Pair with `state restore` to undo volatile changes.",
  transport: "mqtt",
  exitCodes: [0, 1, 3, 4, 5],
  examples: [
    {
      description: "Snapshot before tuning",
      cmd: "ankerts state snapshot --json | jq '.hotendPid'",
    },
  ],
  async run(ctx) {
    const client = ctx.client();
    const settings = await client.snapshotState();
    await client.close();
    ctx.out.emit(settings);
  },
});

const stateRestore: CommandSpec = defineCommand({
  path: ["state", "restore"],
  summary: "Reload settings from EEPROM (M501), discarding volatile changes.",
  description:
    "Sends M501 to reload the saved EEPROM settings, reverting any volatile (RAM) changes " +
    "made this power cycle (e.g. an `M900 K` that would otherwise contaminate the next print).",
  transport: "mqtt",
  exitCodes: [0, 1, 3, 4, 5, 7],
  examples: [{ cmd: "ankerts state restore" }],
  async run(ctx) {
    const client = ctx.client();
    const result = await client.restoreState();
    await client.close();
    ctx.out.emit(result);
  },
});

export const gcodeCommands = [gcode, stateSnapshot, stateRestore];
