/**
 * worldcup — drive a WLED LED matrix as a live FIFA World Cup scoreboard.
 *
 *   worldcup run        --wled <ip> [--key <api-key>] [--provider …]
 *   worldcup demo       --wled <ip> [--speed 6]            # scripted fake match
 *   worldcup preview    [--out ./preview]                  # PNGs, no hardware
 *   worldcup calibrate  --wled <ip> [--pattern axes|border|fill|walk]
 *   worldcup once       [--key <api-key>] [--provider …]   # print current data
 *
 * Most flags also read from env (WC_WLED_HOST, WC_API_KEY, WC_PROVIDER, …) so it
 * runs cleanly as a service or container. See README for the full matrix.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { Canvas } from "./canvas.js";
import { resolveConfig, type ConfigFlags } from "./config.js";
import { DdpSender } from "./ddp.js";
import { Engine } from "./engine.js";
import { buildPixelOrder, serializeFrame } from "./matrix.js";
import { toPng, tile } from "./preview.js";
import { createProvider, mockProvider } from "./providers/index.js";
import { drawAxes, drawBorder, drawFill, drawSinglePixel } from "./scenes/calibrate.js";
import { drawGoal } from "./scenes/goal.js";
import { drawIdle } from "./scenes/idle.js";
import { drawKickoff } from "./scenes/kickoff.js";
import { drawScoreboard } from "./scenes/scoreboard.js";
import { resolveTeam } from "./teams.js";
import type { Match } from "./model.js";

const log = (msg: string): void => console.log(`[worldcup] ${msg}`);

const OPTIONS = {
  wled: { type: "string" },
  port: { type: "string" },
  width: { type: "string" },
  height: { type: "string" },
  layout: { type: "string" },
  serpentine: { type: "boolean" },
  flipX: { type: "boolean" },
  flipY: { type: "boolean" },
  brightness: { type: "string" },
  fps: { type: "string" },
  provider: { type: "string" },
  key: { type: "string" },
  league: { type: "string" },
  season: { type: "string" },
  competition: { type: "string" },
  poll: { type: "string" },
  idle: { type: "string" },
  out: { type: "string" },
  pattern: { type: "string" },
  speed: { type: "string" },
} as const;

export async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: OPTIONS,
    allowPositionals: true,
  });
  const command = positionals[0] ?? "help";
  const flags = values as ConfigFlags & { out?: string; pattern?: string; speed?: string };

  switch (command) {
    case "run":
      return cmdRun(flags);
    case "demo":
      return cmdDemo(flags);
    case "preview":
      return cmdPreview(flags);
    case "calibrate":
      return cmdCalibrate(flags);
    case "once":
      return cmdOnce(flags);
    default:
      printHelp();
  }
}

async function cmdRun(flags: ConfigFlags): Promise<void> {
  const cfg = resolveConfig(flags);
  if (!cfg.wledHost) throw new Error("missing WLED host — pass --wled <ip> or set WC_WLED_HOST");
  const provider = createProvider(cfg);
  log(
    `provider=${provider.name} matrix=${cfg.matrix.width}x${cfg.matrix.height} (${cfg.matrix.layout}) → ${cfg.wledHost}:${cfg.wledPort} @ ${cfg.fps}fps`,
  );
  const engine = new Engine(cfg, provider, { log });
  await engine.start();
  await untilInterrupt(() => engine.stop());
}

async function cmdDemo(flags: ConfigFlags & { speed?: string }): Promise<void> {
  const cfg = resolveConfig({ ...flags, provider: "mock" });
  if (!cfg.wledHost)
    throw new Error("demo needs a WLED host — pass --wled <ip> (or use `preview` for PNGs)");
  const provider = mockProvider({ speed: flags.speed ? Number(flags.speed) : 6 });
  log(`DEMO scripted match → ${cfg.wledHost}:${cfg.wledPort} (Ctrl-C to stop)`);
  const engine = new Engine({ ...cfg, pollLive: 1, pollIdle: 2 }, provider, { log });
  await engine.start();
  await untilInterrupt(() => engine.stop());
}

function cmdPreview(flags: ConfigFlags & { out?: string }): void {
  const cfg = resolveConfig(flags);
  const out = flags.out ?? "preview";
  mkdirSync(out, { recursive: true });
  const W = cfg.matrix.width;
  const H = cfg.matrix.height;
  const side = (code: string, name: string, score: number) => ({
    team: resolveTeam({ code, name }),
    score,
  });

  const scenes: Canvas[] = [];
  const add = (fn: (c: Canvas) => void): void => {
    const c = new Canvas(W, H);
    fn(c);
    scenes.push(c);
  };
  const live: Match = {
    id: "1",
    status: "live",
    minute: 67,
    stage: "GROUP A",
    home: side("ENG", "England", 2),
    away: side("FRA", "France", 1),
  };
  const ht: Match = {
    id: "2",
    status: "halftime",
    stage: "FINAL",
    home: side("BRA", "Brazil", 1),
    away: side("ARG", "Argentina", 0),
  };
  const ft: Match = {
    id: "3",
    status: "finished",
    home: side("DEU", "Germany", 0),
    away: side("ESP", "Spain", 3),
  };
  const ko: Match = {
    id: "4",
    status: "scheduled",
    stage: "GROUP D",
    kickoff: new Date(Date.now() + 23 * 60000).toISOString(),
    home: side("USA", "USA", 0),
    away: side("MEX", "Mexico", 0),
  };

  add((c) => drawScoreboard(c, live, 0));
  add((c) => drawScoreboard(c, ht));
  add((c) => drawScoreboard(c, ft));
  add((c) => drawKickoff(c, ko, new Date()));
  add((c) => drawIdle(c, new Date(), 0));
  add((c) => drawGoal(c, resolveTeam({ code: "ENG", name: "England" }), 0.2));
  add((c) => drawGoal(c, resolveTeam({ code: "ENG", name: "England" }), 1.0));
  add((c) => drawGoal(c, resolveTeam({ code: "BRA", name: "Brazil" }), 1.4));

  writeFileSync(join(out, "storyboard.png"), toPng(tile(scenes, 4, 2), { scale: 10 }));
  log(`wrote ${join(out, "storyboard.png")}`);
}

async function cmdCalibrate(flags: ConfigFlags & { pattern?: string }): Promise<void> {
  const cfg = resolveConfig(flags);
  if (!cfg.wledHost) throw new Error("calibrate needs a WLED host — pass --wled <ip>");
  const order = buildPixelOrder(cfg.matrix);
  const sender = new DdpSender({ host: cfg.wledHost, port: cfg.wledPort });
  const canvas = new Canvas(cfg.matrix.width, cfg.matrix.height);
  const send = (): Promise<void> => sender.send(serializeFrame(canvas.data, order, cfg.brightness));
  const pattern = flags.pattern ?? "axes";
  log(
    `calibrate pattern=${pattern} layout=${cfg.matrix.layout} serpentine=${cfg.matrix.serpentine}`,
  );

  if (pattern === "walk") {
    // Light each logical index briefly so the wiring path can be observed.
    for (let i = 0; i < canvas.width * canvas.height; i++) {
      drawSinglePixel(canvas, i);
      await send();
      log(`index ${i} → x=${i % canvas.width} y=${Math.floor(i / canvas.width)}`);
      await sleep(150);
    }
    sender.close();
    return;
  }

  const draw = pattern === "border" ? drawBorder : pattern === "fill" ? drawFill : drawAxes;
  // Hold the static pattern, refreshing under WLED's 2.5s realtime timeout.
  const timer = setInterval(() => {
    draw(canvas);
    void send();
  }, 1000);
  await untilInterrupt(() => {
    clearInterval(timer);
    sender.close();
  });
}

async function cmdOnce(flags: ConfigFlags): Promise<void> {
  const cfg = resolveConfig(flags);
  const provider = createProvider(cfg);
  const matches = await provider.fetchMatches();
  log(`${provider.name}: ${matches.length} match(es)`);
  for (const m of matches) {
    const min = m.minute != null ? ` ${m.minute}'` : "";
    log(
      `  ${m.status.toUpperCase().padEnd(9)} ${m.home.team.code} ${m.home.score}-${m.away.score} ${m.away.team.code}${min}${m.stage ? ` [${m.stage}]` : ""}`,
    );
  }
}

function printHelp(): void {
  console.log(
    [
      "worldcup — WLED World Cup scoreboard",
      "",
      "Commands:",
      "  run         stream the live scoreboard to WLED",
      "  demo        stream a scripted fake match (no API key needed)",
      "  preview     render sample scenes to PNG (no hardware)",
      "  calibrate   send a test pattern to map the panel (--pattern axes|border|fill|walk)",
      "  once        fetch and print the current match data",
      "",
      "Common flags: --wled <ip> --key <api-key> --provider api-football|football-data|mock",
      "              --width 32 --height 30 --layout wled|horizontal|vertical --brightness 0.7",
      "Env: WC_WLED_HOST, WC_API_KEY, WC_PROVIDER, WC_WIDTH, WC_HEIGHT, WC_BRIGHTNESS …",
    ].join("\n"),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Resolve on SIGINT/SIGTERM, running `onStop` for cleanup. */
function untilInterrupt(onStop: () => void): Promise<void> {
  return new Promise((resolve) => {
    const handler = (): void => {
      onStop();
      resolve();
    };
    process.once("SIGINT", handler);
    process.once("SIGTERM", handler);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[worldcup] ${(err as Error).message}`);
    process.exit(1);
  });
}
