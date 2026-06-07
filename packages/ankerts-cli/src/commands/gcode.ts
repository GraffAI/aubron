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
  summary: "Send gcode and return the parsed response (truncation-aware).",
  description:
    "Publishes gcode over MQTT and parses the reply into raw text, fields/reports, ok, " +
    "recognized, and timedOut (distinct from recognized:false — a timeout is not a " +
    "rejection). The firmware returns each reply as a single ~512-byte serial-buffer " +
    "snapshot, so long replies (or one caught mid-write, e.g. M900) come back partial: " +
    "those are flagged `truncated:true` (with a stderr warning) instead of being passed " +
    "off as complete like the reference's `echo:Ad` bug. Accepts one command as args, " +
    "many via --batch <file>, or `-` to read stdin (one per line, NDJSON result per line). " +
    "State-mutating commands print a volatility warning on stderr unless --yes. Default " +
    "timeouts are latency-class aware (M109/M190/G29/M303 get minutes); --wait-motion " +
    "appends M400 so the call returns on true motion completion, not queue-accept.",
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
      description: "Read the firmware name (long reply → truncated:true, name still present)",
      cmd: "ankerts gcode M115 --json | jq '{firmware:.fields.FIRMWARE_NAME, truncated}'",
      output: '{ "firmware": "Marlin V8111_V3.2.2 (...)", "truncated": true }',
    },
    {
      description: "A short reply comes back whole",
      cmd: "ankerts gcode M105 --json | jq -r '.raw'",
      output: "ok T:29.12 /0.00 B:30.31 /0.00",
    },
    {
      description: "Detect an unknown command (not a truncation)",
      cmd: "ankerts gcode M9998 --json | jq '{recognized, truncated}'",
      output: '{ "recognized": false, "truncated": false }',
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
      if (result.truncated) {
        ctx.out.log(
          "warning: reply was truncated by the firmware's ~512-byte serial buffer (truncated=true) — output may be incomplete.",
        );
      }
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
