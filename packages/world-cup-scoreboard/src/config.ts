/**
 * Runtime configuration, resolved from CLI flags with environment-variable
 * fallbacks so the daemon can run as a systemd/launchd service or a container
 * with secrets in the environment.
 */
import { DEFAULT_MATRIX, type Layout, type MatrixConfig } from "./matrix.js";

export type ProviderKind = "api-football" | "football-data" | "mock";
export type IdleMode = "clock" | "off";

export interface Config {
  wledHost?: string;
  wledPort: number;
  matrix: MatrixConfig;
  brightness: number;
  /** Gamma applied to LED output (>1 deepens colours; 1 = raw sRGB). */
  gamma: number;
  fps: number;
  provider: ProviderKind;
  apiKey?: string;
  league: number;
  season: number;
  competition: string;
  /** Seconds between polls while a match is live. */
  pollLive: number;
  /** Seconds between polls while idle. */
  pollIdle: number;
  /** Seconds each match is shown before rotating to the next concurrent one. */
  rotateSec: number;
  idleMode: IdleMode;
  /** Show the pre-match card when kickoff is within this many minutes. */
  upcomingWithinMin: number;
  /** Keep showing a finished match for this many minutes after full time. */
  finishedLingerMin: number;
}

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export interface ConfigFlags {
  wled?: string;
  port?: string;
  width?: string;
  height?: string;
  layout?: string;
  serpentine?: boolean;
  flipX?: boolean;
  flipY?: boolean;
  brightness?: string;
  gamma?: string;
  fps?: string;
  provider?: string;
  key?: string;
  league?: string;
  season?: string;
  competition?: string;
  poll?: string;
  rotate?: string;
  idle?: string;
}

function asLayout(v: string | undefined, fallback: Layout): Layout {
  return v === "wled" || v === "horizontal" || v === "vertical" ? v : fallback;
}

function asProvider(v: string | undefined): ProviderKind {
  if (v === "api-football" || v === "football-data" || v === "mock") return v;
  // Default: live-capable provider if a key is present, else mock.
  return process.env.WC_API_KEY ? "api-football" : "mock";
}

/** Merge CLI flags over environment defaults into a resolved Config. */
export function resolveConfig(flags: ConfigFlags = {}): Config {
  const provider = asProvider(flags.provider ?? process.env.WC_PROVIDER);
  const matrix: MatrixConfig = {
    width: flags.width ? Number(flags.width) : envNum("WC_WIDTH", DEFAULT_MATRIX.width),
    height: flags.height ? Number(flags.height) : envNum("WC_HEIGHT", DEFAULT_MATRIX.height),
    layout: asLayout(flags.layout ?? process.env.WC_LAYOUT, DEFAULT_MATRIX.layout),
    serpentine: flags.serpentine ?? process.env.WC_SERPENTINE !== "false",
    flipX: flags.flipX ?? process.env.WC_FLIP_X === "true",
    flipY: flags.flipY ?? process.env.WC_FLIP_Y === "true",
  };

  return {
    wledHost: flags.wled ?? process.env.WC_WLED_HOST,
    wledPort: flags.port ? Number(flags.port) : envNum("WC_WLED_PORT", 4048),
    matrix,
    brightness: flags.brightness ? Number(flags.brightness) : envNum("WC_BRIGHTNESS", 1),
    gamma: flags.gamma ? Number(flags.gamma) : envNum("WC_GAMMA", 2.2),
    fps: flags.fps ? Number(flags.fps) : envNum("WC_FPS", 20),
    provider,
    apiKey: flags.key ?? process.env.WC_API_KEY,
    league: flags.league ? Number(flags.league) : envNum("WC_LEAGUE", 1),
    season: flags.season ? Number(flags.season) : envNum("WC_SEASON", 2026),
    competition: flags.competition ?? process.env.WC_COMPETITION ?? "WC",
    // Poll briskly while live to catch goals within a few seconds. At ~15s live
    // (240/h) and 120s idle (30/h) this sits comfortably inside a 7500/day plan.
    pollLive: flags.poll
      ? Number(flags.poll)
      : envNum("WC_POLL_LIVE", provider === "mock" ? 2 : 15),
    pollIdle: envNum("WC_POLL_IDLE", provider === "mock" ? 5 : 120),
    rotateSec: flags.rotate ? Number(flags.rotate) : envNum("WC_ROTATE", 15),
    idleMode: (flags.idle ?? process.env.WC_IDLE_MODE) === "off" ? "off" : "clock",
    upcomingWithinMin: envNum("WC_UPCOMING_MIN", 30),
    finishedLingerMin: envNum("WC_FINISHED_LINGER_MIN", 60),
  };
}
