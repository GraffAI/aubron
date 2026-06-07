/**
 * Printer commands: list, status (+ --watch), select, wait.
 */
import { parseWaitCondition, type PrinterStatus } from "@aubron/ankerts";
import { defineCommand, type CommandSpec } from "../spec.js";
import { flagBool, requirePositional, timeoutMs } from "../runtime.js";

const list: CommandSpec = defineCommand({
  path: ["printer", "list"],
  summary: "List the printers on the account.",
  description:
    "Reads the printer list from stored config (populated at login). No network call. " +
    "Each entry includes DUID, serial, model, and the discovered LAN IP (empty until " +
    "you run `ankerts discover --store`).",
  transport: "none",
  exitCodes: [0, 1, 4],
  examples: [
    {
      description: "Get the first printer's DUID, clean stdout",
      cmd: "ankerts printer list --json | jq -r '.[0].duid'",
      output: "USPRAKM-000994-YYLLG",
    },
    { description: "Bare DUIDs for scripting", cmd: "ankerts printer list -q" },
  ],
  run(ctx) {
    const printers = ctx.client().listPrinters();
    ctx.out.emit(printers, { quietProjection: ["duid"] });
  },
});

const status: CommandSpec = defineCommand({
  path: ["printer", "status"],
  summary: "Show temperatures, job state, and progress.",
  description:
    "Queries server-authoritative status over MQTT and normalizes it: temperatures in " +
    "°C (converted from 1/100 °C), progress 0–100. For third-party-sliced gcode the " +
    "firmware's headline ETA is unreliable, so etaReliable is false and the bogus ETA is " +
    "omitted. With --watch, streams status objects as NDJSON (one per line) until interrupted.",
  transport: "mqtt",
  flags: [
    { name: "watch", type: "boolean", description: "Stream status as NDJSON until interrupted." },
    { name: "poll", type: "string", description: "Watch poll interval in seconds (default 2)." },
  ],
  exitCodes: [0, 1, 3, 4, 5],
  examples: [
    { description: "One-shot status", cmd: "ankerts printer status --json | jq '.nozzle'" },
    {
      description: "Watch a print (NDJSON stream)",
      cmd: "ankerts printer status --watch | jq -r '.job.progressPct'",
    },
  ],
  async run(ctx) {
    const client = ctx.client();
    if (!flagBool(ctx.args, "watch")) {
      const s = await client.getStatus();
      await client.close();
      ctx.out.emit(s);
      return;
    }
    const pollSec = Number(ctx.args.values.poll ?? 2) || 2;
    ctx.out.log("watching status (NDJSON on stdout); Ctrl-C to stop.");
    await client.subscribeEvents(() => {});
    // Poll snapshots on an interval as the robust floor; emit NDJSON to stdout.
    for (;;) {
      const s = await client.getStatus();
      ctx.out.ndjsonLine(s);
      await new Promise((r) => setTimeout(r, pollSec * 1000));
    }
  },
});

const select: CommandSpec = defineCommand({
  path: ["printer", "select"],
  summary: "Set the default printer in config.",
  description:
    "Selects a printer (by DUID, serial, name, or index) as the default target for " +
    "subsequent commands. Persisted to the config store.",
  transport: "none",
  args: [
    {
      name: "duid|index",
      description: "Printer reference (DUID, serial, name, or index).",
      required: true,
    },
  ],
  exitCodes: [0, 1, 2, 4],
  examples: [
    { description: "Select by index", cmd: "ankerts printer select 0" },
    { description: "Select by DUID", cmd: "ankerts printer select USPRAKM-000994-YYLLG" },
  ],
  run(ctx) {
    const ref = requirePositional(ctx, 0, "duid|index");
    const printer = ctx.client().selectPrinter(ref);
    ctx.out.emit({ selected: printer.duid, name: printer.name });
  },
});

const wait: CommandSpec = defineCommand({
  path: ["printer", "wait"],
  summary: "Block until a printer condition holds (re-attachable).",
  description:
    "Watches server-authoritative state and resolves once the condition holds — so a " +
    "wait killed mid-flight can simply be re-issued and re-derives current state. " +
    "Streams NDJSON status ticks on stderr while waiting; on success prints the final " +
    "status to stdout (exit 0); on timeout exits 5 (retriable). Conditions: connected | " +
    "lan | nozzle>=C | bed>=C | temp-stable | printing | idle | progress>=pct | layer>=n | " +
    "complete | failed | cancelled | runout.",
  transport: "mqtt",
  flags: [
    { name: "until", type: "string", description: "The condition to wait for (required)." },
    { name: "poll", type: "string", description: "Poll interval in seconds (default 2)." },
  ],
  exitCodes: [0, 1, 3, 4, 5],
  examples: [
    {
      description: "Wait for the job to actually start (not just upload-accepted)",
      cmd: "ankerts printer wait --until printing --timeout 120",
    },
    {
      description: "Cool down after the print completes",
      cmd: 'ankerts printer wait --until complete && ankerts gcode "M104 S0"',
    },
  ],
  async run(ctx) {
    const until = ctx.args.values.until;
    if (typeof until !== "string" || until === "") {
      const { UsageError } = await import("@aubron/ankerts");
      throw new UsageError({ message: "--until <condition> is required" });
    }
    const cond = parseWaitCondition(until);
    const client = ctx.client();
    const pollSec = Number(ctx.args.values.poll ?? 2) || 2;
    const final = await client.waitFor(cond, {
      timeoutMs: timeoutMs(ctx, 600000),
      pollMs: pollSec * 1000,
      onTick: (s: PrinterStatus) => ctx.out.log(JSON.stringify(s)),
    });
    await client.close();
    ctx.out.emit(final);
  },
});

export const printerCommands = [list, status, select, wait];
