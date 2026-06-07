/**
 * Job/transport commands: discover, print, job cancel|pause|resume, camera capture.
 */
import { AnkerError } from "@aubron/ankerts";
import { defineCommand, type CommandSpec } from "../spec.js";
import { flagBool, requirePositional, timeoutMs } from "../runtime.js";

const discover: CommandSpec = defineCommand({
  path: ["discover"],
  summary: "Find printers on the local network (PPPP LAN search).",
  description:
    "Broadcasts a PPPP LAN_SEARCH over UDP and collects replies. Discovery is flaky " +
    "(UDP broadcast), so it retries. With --store, the discovered IPs are written into " +
    "config — the prerequisite for LAN file upload. `print` runs this automatically when " +
    "a printer's IP is missing.",
  transport: "pppp",
  flags: [
    { name: "store", type: "boolean", description: "Write discovered IPs into config." },
    { name: "retries", type: "string", description: "Discovery attempts (default 3)." },
  ],
  exitCodes: [0, 1, 5],
  examples: [
    { description: "Discover and store IPs", cmd: "ankerts discover --store" },
    {
      description: "Bare DUIDs of printers on the LAN",
      cmd: "ankerts discover -q | xargs -n1 echo found:",
    },
  ],
  async run(ctx) {
    const client = ctx.client();
    const retries = Number(ctx.args.values.retries ?? 3) || 3;
    const found = await client.discoverLan({
      store: flagBool(ctx.args, "store"),
      retries,
      timeoutMs: timeoutMs(ctx, 1000),
    });
    ctx.out.emit(found, { quietProjection: ["duid"] });
  },
});

const print: CommandSpec = defineCommand({
  path: ["print"],
  summary: "Upload a gcode file over the LAN and start the print.",
  description:
    "Uploads via PPPP (LAN only) and, by default, starts the job. Auto-runs discovery " +
    "to find/store the printer IP if it is unknown. Off-LAN this exits 6 (transport " +
    "unavailable) with a structured error naming PPPP and the `discover --store` fix. " +
    "Upload progress streams as NDJSON on stderr. `print` returns a job handle by default " +
    "(it does NOT hold the process for the whole print) — use --wait-start to block until " +
    "the job actually starts, or detach and poll with `printer wait --until complete`. " +
    "By DEFAULT it auto-fixes the LCD ETA: a third-party slicer's embedded time/filament " +
    "estimate is transcoded into the Anker `;TIME:` header (auto-detected — a no-op on " +
    "natively-sliced files; always on a copy, never mutating your file). Pass " +
    "--no-fix-metadata to upload the file byte-for-byte untouched.",
  transport: "pppp",
  args: [{ name: "file.gcode", description: "Path to the gcode file to upload.", required: true }],
  flags: [
    { name: "no-start", type: "boolean", description: "Upload only; don't start the print." },
    { name: "transport", type: "string", description: "lan | auto (default auto; LAN only here)." },
    {
      name: "no-fix-metadata",
      type: "boolean",
      description: "Upload the file untouched (skip the automatic slicer-metadata ETA fix).",
    },
    {
      name: "wait-start",
      type: "boolean",
      description: "Block until the job state flips to printing.",
    },
    {
      name: "wait-complete",
      type: "boolean",
      description: "Block until the print completes (long-running, resumable).",
    },
  ],
  exitCodes: [0, 1, 4, 5, 6, 7],
  examples: [
    {
      description: "Upload + start (auto-discovers IP if needed)",
      cmd: "ankerts print tower.gcode",
      output: '{ "name": "tower.gcode", "started": true, "transport": "lan" }',
    },
    {
      description: "Off-LAN failure is structured and actionable (exit 6)",
      cmd: "ankerts print tower.gcode --json | jq -r '.error.hint'",
      output: "Run `ankerts discover --store` while on the same LAN as the printer, then retry.",
    },
    {
      description: "Upload an OrcaSlicer file untouched (no automatic ETA fix)",
      cmd: "ankerts print tower.gcode --no-fix-metadata",
    },
  ],
  async run(ctx) {
    const file = requirePositional(ctx, 0, "file.gcode");
    const client = ctx.client();

    if (ctx.globals.dryRun) {
      ctx.out.emit({
        dryRun: true,
        action: "print",
        file,
        start: !flagBool(ctx.args, "no-start"),
        fixMetadata: !flagBool(ctx.args, "no-fix-metadata"),
      });
      return;
    }

    const result = await client.uploadAndPrint(file, {
      start: !flagBool(ctx.args, "no-start"),
      fixMetadata: flagBool(ctx.args, "fix-metadata"),
      transport: (ctx.args.values.transport as "lan" | "auto") ?? "auto",
      onProgress: (p) => ctx.out.log(JSON.stringify({ event: "upload", ...p })),
    });

    if (flagBool(ctx.args, "wait-start") || flagBool(ctx.args, "wait-complete")) {
      const { parseWaitCondition } = await import("@aubron/ankerts");
      const cond = flagBool(ctx.args, "wait-complete") ? "complete" : "printing";
      ctx.out.log(`waiting for job to reach "${cond}"…`);
      await client.waitFor(parseWaitCondition(cond), {
        timeoutMs: timeoutMs(ctx, flagBool(ctx.args, "wait-complete") ? 86400000 : 120000),
        onTick: (s) => ctx.out.log(JSON.stringify(s)),
      });
    }
    await client.close();
    ctx.out.emit(result);
  },
});

function jobControl(verb: "cancel" | "pause" | "resume"): CommandSpec {
  return defineCommand({
    path: ["job", verb],
    summary: `${verb[0]!.toUpperCase()}${verb.slice(1)} the current print job.`,
    description:
      `Sends the ${verb} control command to the printer over MQTT (PRINT_CONTROL). ` +
      "The control values were reverse-engineered and confirmed live on an M5: cancel " +
      "returns the printer to idle with the heaters off; pause/resume toggle the print.",
    transport: "mqtt",
    exitCodes: [0, 1, 3, 4, 5, 7],
    examples: [{ cmd: `ankerts job ${verb}` }],
    async run(ctx) {
      const client = ctx.client();
      if (ctx.globals.dryRun) {
        ctx.out.emit({ dryRun: true, action: `job ${verb}` });
        return;
      }
      if (verb === "cancel") await client.cancelJob();
      else if (verb === "pause") await client.pauseJob();
      else await client.resumeJob();
      await client.close();
      ctx.out.emit({ ok: true, action: verb });
    },
  });
}

const camera: CommandSpec = defineCommand({
  path: ["camera", "capture"],
  summary: "Capture the printer's video stream (PPPP, optional).",
  description:
    "Captures the H.264 video stream over PPPP. This is lower-priority and not yet wired " +
    "in this version; it returns a structured not-implemented error so agents can branch " +
    "cleanly rather than hang.",
  transport: "pppp",
  args: [
    { name: "out.h264", description: "Output file for the raw H.264 stream.", required: true },
  ],
  flags: [{ name: "max-size", type: "string", description: "Maximum bytes to capture." }],
  exitCodes: [0, 1, 4, 5],
  examples: [{ cmd: "ankerts camera capture out.h264 --max-size 5000000" }],
  run(ctx) {
    requirePositional(ctx, 0, "out.h264");
    throw new AnkerError({
      code: "not_implemented",
      message: "Camera capture is not yet implemented in this version.",
      transport: "pppp",
      hint: "Use `ankerts printer status` for telemetry; camera streaming is planned.",
    });
  },
});

export const jobCommands = [
  discover,
  print,
  jobControl("cancel"),
  jobControl("pause"),
  jobControl("resume"),
  camera,
];
