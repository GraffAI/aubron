/**
 * Keyless mock provider: simulates one match progressing in real time, with
 * scripted goals, a halftime pause and full time. Used by `worldcup demo` to
 * exercise the whole pipeline (including the GOAL celebration) without an API
 * key or a live tournament. Time is compressed via `speed` (match-minutes per
 * real second) so a full match plays out in seconds.
 */
import type { MatchStatus } from "../model.js";
import { buildMatch, type Provider } from "./types.js";

export interface MockOptions {
  home?: { code: string; name: string };
  away?: { code: string; name: string };
  /** Match-minutes elapsed per real second (default 6 → ~90' in 15s). */
  speed?: number;
  /** Goal events as [matchMinute, "home" | "away"]. */
  goals?: Array<[number, "home" | "away"]>;
  stage?: string;
  now?: () => number;
}

const DEFAULT_GOALS: Array<[number, "home" | "away"]> = [
  [12, "home"],
  [34, "away"],
  [58, "away"],
  [73, "home"],
  [88, "home"],
];

export function mockProvider(opts: MockOptions = {}): Provider {
  const home = opts.home ?? { code: "BRA", name: "Brazil" };
  const away = opts.away ?? { code: "ARG", name: "Argentina" };
  const speed = opts.speed ?? 6;
  const goals = (opts.goals ?? DEFAULT_GOALS).slice().sort((a, b) => a[0] - b[0]);
  const now = opts.now ?? Date.now;
  const start = now();

  return {
    name: "mock",
    async fetchMatches() {
      const elapsedSec = (now() - start) / 1000;
      const rawMinute = elapsedSec * speed;

      let status: MatchStatus;
      let minute: number;
      if (rawMinute < 0.0) {
        status = "scheduled";
        minute = 0;
      } else if (rawMinute < 45) {
        status = "live";
        minute = Math.floor(rawMinute) + 1;
      } else if (rawMinute < 50) {
        status = "halftime";
        minute = 45;
      } else if (rawMinute < 95) {
        status = "live";
        minute = Math.min(90, Math.floor(rawMinute - 5) + 1);
      } else {
        status = "finished";
        minute = 90;
      }

      // Effective match-minute for goal accounting (skip the 5' fake HT gap).
      const matchMinute = rawMinute < 45 ? rawMinute : rawMinute - 5;
      let h = 0;
      let a = 0;
      for (const [m, side] of goals) {
        if (matchMinute < m) continue;
        if (side === "home") h++;
        else a++;
      }

      return [
        buildMatch({
          id: "mock-1",
          status,
          minute: status === "halftime" ? 45 : minute,
          stage: opts.stage ?? "FINAL",
          home: { ...home, score: h },
          away: { ...away, score: a },
        }),
      ];
    },
  };
}
