/**
 * The engine ties everything together:
 *
 *   poll provider → pick the match to show → detect score changes → render the
 *   right scene each frame → serialize to physical LED order → stream over DDP.
 *
 * Scene/selection logic is exported as pure functions (`pickMatch`,
 * `detectGoal`) so it can be unit-tested without a network or a socket.
 */
import { Canvas } from "./canvas.js";
import type { Config } from "./config.js";
import { DdpSender } from "./ddp.js";
import { buildPixelOrder, serializeFrame, type MatrixConfig } from "./matrix.js";
import { isActive, type Match } from "./model.js";
import type { Provider } from "./providers/types.js";
import { drawGoal, GOAL_DURATION } from "./scenes/goal.js";
import { drawIdle } from "./scenes/idle.js";
import { drawKickoff } from "./scenes/kickoff.js";
import { drawScoreboard } from "./scenes/scoreboard.js";
import type { Team } from "./teams.js";

export interface GoalEvent {
  side: "home" | "away";
  team: Team;
}

function minutesUntil(iso: string | undefined, now: Date): number {
  if (!iso) return Infinity;
  return (new Date(iso).getTime() - now.getTime()) / 60000;
}

/**
 * Choose the single most relevant match to display, or null for idle. Priority:
 * live/halftime (most advanced first) → upcoming-soon → recently-finished.
 */
export function pickMatch(
  matches: Match[],
  now: Date,
  cfg: Pick<Config, "upcomingWithinMin" | "finishedLingerMin">,
): Match | null {
  const active = matches.filter((m) => isActive(m.status));
  if (active.length > 0) {
    return active.sort((a, b) => rank(a) - rank(b) || (b.minute ?? 0) - (a.minute ?? 0))[0]!;
  }

  const upcoming = matches
    .filter((m) => m.status === "scheduled")
    .map((m) => ({ m, mins: minutesUntil(m.kickoff, now) }))
    .filter((x) => x.mins >= 0 && x.mins <= cfg.upcomingWithinMin)
    .sort((a, b) => a.mins - b.mins);
  if (upcoming.length > 0) return upcoming[0]!.m;

  // Recently finished: approximate finish time as kickoff + ~115min.
  const finished = matches
    .filter((m) => m.status === "finished")
    .map((m) => ({ m, since: -minutesUntil(m.kickoff, now) - 115 }))
    .filter((x) => x.since >= 0 && x.since <= cfg.finishedLingerMin)
    .sort((a, b) => a.since - b.since);
  if (finished.length > 0) return finished[0]!.m;

  return null;
}

function rank(m: Match): number {
  return m.status === "live" ? 0 : m.status === "halftime" ? 1 : 2;
}

/** Detect a goal by comparing a previous and current view of the same match. */
export function detectGoal(prev: Match | undefined, next: Match): GoalEvent | null {
  if (!prev || prev.id !== next.id) return null;
  if (next.home.score > prev.home.score) return { side: "home", team: next.home.team };
  if (next.away.score > prev.away.score) return { side: "away", team: next.away.team };
  return null;
}

export interface EngineHooks {
  /** Called with each rendered frame; default streams it over DDP. */
  onFrame?: (canvas: Canvas) => void;
  log?: (msg: string) => void;
}

export class Engine {
  private readonly cfg: Config;
  private readonly provider: Provider;
  private readonly canvas: Canvas;
  private readonly order: Int32Array;
  private readonly sender: DdpSender | null;
  private readonly log: (msg: string) => void;
  private readonly onFrame?: (canvas: Canvas) => void;

  private current: Match | null = null;
  private prevByMatch = new Map<string, Match>();
  private goalTeam: Team | null = null;
  private goalStartSec = 0;
  private startSec = 0;
  private renderTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(cfg: Config, provider: Provider, hooks: EngineHooks = {}) {
    this.cfg = cfg;
    this.provider = provider;
    this.canvas = new Canvas(cfg.matrix.width, cfg.matrix.height);
    this.order = buildPixelOrder(cfg.matrix as MatrixConfig);
    this.sender =
      hooks.onFrame || !cfg.wledHost
        ? null
        : new DdpSender({ host: cfg.wledHost, port: cfg.wledPort });
    this.onFrame = hooks.onFrame;
    this.log = hooks.log ?? (() => {});
  }

  async start(): Promise<void> {
    this.startSec = nowSec();
    await this.poll();
    this.renderTimer = setInterval(() => void this.tick(), Math.round(1000 / this.cfg.fps));
  }

  stop(): void {
    this.stopped = true;
    if (this.renderTimer) clearInterval(this.renderTimer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.sender?.close();
  }

  /** Fetch matches, update the picked match, and fire goal celebrations. */
  private async poll(): Promise<void> {
    try {
      const matches = await this.provider.fetchMatches();
      const picked = pickMatch(matches, new Date(), this.cfg);
      if (picked) {
        const goal = detectGoal(this.prevByMatch.get(picked.id), picked);
        if (goal) {
          this.goalTeam = goal.team;
          this.goalStartSec = nowSec();
          this.log(
            `GOAL! ${goal.team.code} (${picked.home.team.code} ${picked.home.score}-${picked.away.score} ${picked.away.team.code})`,
          );
        }
        this.prevByMatch.set(picked.id, picked);
      }
      if (picked?.id !== this.current?.id) {
        this.log(
          picked
            ? `now showing ${picked.home.team.code} v ${picked.away.team.code} (${picked.status})`
            : "no match — idle",
        );
      }
      this.current = picked;
    } catch (err) {
      this.log(`poll error: ${(err as Error).message}`);
    } finally {
      if (!this.stopped) {
        const wait =
          (this.current && isActive(this.current.status) ? this.cfg.pollLive : this.cfg.pollIdle) *
          1000;
        this.pollTimer = setTimeout(() => void this.poll(), wait);
      }
    }
  }

  /** Render one frame and hand it to DDP (or the onFrame hook). */
  private tick(): void {
    const t = nowSec() - this.startSec;
    const sent = this.render(t);
    if (!sent) return;
    if (this.onFrame) {
      this.onFrame(this.canvas);
      return;
    }
    const frame = serializeFrame(this.canvas.data, this.order, this.cfg.brightness);
    void this.sender?.send(frame).catch((err) => this.log(`send error: ${(err as Error).message}`));
  }

  /** Compose the canvas for time `t`; returns false if nothing should be sent. */
  render(t: number): boolean {
    const goalElapsed = nowSec() - this.goalStartSec;
    if (this.goalTeam && goalElapsed < GOAL_DURATION) {
      drawGoal(this.canvas, this.goalTeam, goalElapsed);
      return true;
    }
    this.goalTeam = null;

    const m = this.current;
    if (!m) {
      if (this.cfg.idleMode === "off") return false; // let WLED revert to its effects
      drawIdle(this.canvas, new Date(), t);
      return true;
    }
    if (m.status === "scheduled") drawKickoff(this.canvas, m, new Date());
    else drawScoreboard(this.canvas, m, t);
    return true;
  }
}

function nowSec(): number {
  return performance.now() / 1000;
}
