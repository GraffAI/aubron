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
import { selectFixtures } from "./scenes/schedule.js";
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

/**
 * Whether a match is in the "foreground" window: from 30 min before kickoff,
 * through the live match, to an hour after full time. These are the matches the
 * scoreboard/kickoff/FT screens rotate through.
 */
function inWindow(
  m: Match,
  now: Date,
  cfg: Pick<Config, "upcomingWithinMin" | "finishedLingerMin">,
): boolean {
  if (isActive(m.status)) return true;
  if (m.status === "scheduled") {
    const mins = minutesUntil(m.kickoff, now);
    return mins >= 0 && mins <= cfg.upcomingWithinMin;
  }
  if (m.status === "finished") {
    const since = -minutesUntil(m.kickoff, now) - 115; // approx FT = kickoff + 115'
    return since >= 0 && since <= cfg.finishedLingerMin;
  }
  return false;
}

/**
 * The matches to rotate through right now: everything in the foreground window
 * (live first and most-advanced, then upcoming-soonest, then most-recently
 * finished). Empty → the engine drops to the idle fixture rotation.
 */
export function selectDisplaySet(
  matches: Match[],
  now: Date,
  cfg: Pick<Config, "upcomingWithinMin" | "finishedLingerMin">,
): Match[] {
  return matches
    .filter((m) => inWindow(m, now, cfg))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (rank(a) === 0
          ? (b.minute ?? 0) - (a.minute ?? 0) // live: most advanced first
          : a.status === "scheduled"
            ? minutesUntil(a.kickoff, now) - minutesUntil(b.kickoff, now) // soonest first
            : minutesUntil(b.kickoff, now) - minutesUntil(a.kickoff, now)), // most recent first
    );
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

  private matches: Match[] = [];
  /** Matches currently rotated through (all live, or a single fallback pick). */
  private displaySet: Match[] = [];
  private displayIdx = 0;
  private lastRotateSec = 0;
  /** When a goal fires, the match to jump to once the celebration ends. */
  private focusId: string | null = null;
  /** Per-match anchor for the synthetic ticking clock: when this minute began. */
  private clockAnchor = new Map<string, { minute: number; at: number }>();
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

  /** Fetch matches, refresh the rotation set, and fire goal celebrations. */
  private async poll(): Promise<void> {
    try {
      const matches = await this.provider.fetchMatches();
      this.matches = matches;

      // Watch every match for a score change — a goal anywhere should grab the
      // display, even if we're currently showing a different game.
      for (const m of matches) {
        const goal = isActive(m.status) ? detectGoal(this.prevByMatch.get(m.id), m) : null;
        if (goal) {
          this.goalTeam = goal.team;
          this.goalStartSec = nowSec();
          this.focusId = m.id;
          this.log(
            `GOAL! ${goal.team.code} (${m.home.team.code} ${m.home.score}-${m.away.score} ${m.away.team.code})`,
          );
        }
        // Re-anchor the ticking clock whenever the API's minute advances.
        if (m.status === "live" && m.minute != null) {
          const anchor = this.clockAnchor.get(m.id);
          if (!anchor || anchor.minute !== m.minute) {
            this.clockAnchor.set(m.id, { minute: m.minute, at: nowSec() });
          }
        }
        this.prevByMatch.set(m.id, m);
      }

      const prevShownId = this.displaySet[this.displayIdx]?.id;
      const set = selectDisplaySet(matches, new Date(), this.cfg);
      if (set.length !== this.displaySet.length) {
        this.log(set.length > 0 ? `rotating ${set.length} live match(es)` : "no match — idle");
      }
      this.displaySet = set;

      // Keep the same game on screen across polls; jump to a freshly-scored one.
      const keepId = this.focusId ?? prevShownId;
      const idx = keepId ? set.findIndex((m) => m.id === keepId) : -1;
      this.displayIdx = idx >= 0 ? idx : 0;
      if (this.focusId && idx >= 0) this.lastRotateSec = nowSec();
      this.focusId = null;
    } catch (err) {
      this.log(`poll error: ${(err as Error).message}`);
    } finally {
      if (!this.stopped) {
        const anyActive = this.displaySet.some((m) => isActive(m.status));
        const wait = (anyActive ? this.cfg.pollLive : this.cfg.pollIdle) * 1000;
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
    const frame = serializeFrame(this.canvas.data, this.order, this.cfg.brightness, this.cfg.gamma);
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

    if (this.displaySet.length === 0) return this.renderIdle(t);

    // Rotate through the in-window matches on a fixed cadence.
    if (this.displaySet.length > 1 && nowSec() - this.lastRotateSec >= this.cfg.rotateSec) {
      this.displayIdx = (this.displayIdx + 1) % this.displaySet.length;
      this.lastRotateSec = nowSec();
    }
    const m = this.displaySet[this.displayIdx % this.displaySet.length]!;
    if (m.status === "scheduled") drawKickoff(this.canvas, m, new Date());
    else drawScoreboard(this.canvas, m, m.status === "live" ? this.clockLabel(m) : undefined);
    return true;
  }

  /**
   * Idle display: rotate through today's (or tomorrow's) fixtures as GROUP-style
   * countdown cards, alternating with the clock, every `rotateSec`.
   */
  private renderIdle(t: number): boolean {
    if (this.cfg.idleMode === "off") return false; // let WLED revert to its effects
    const now = new Date();
    const fixtures = selectFixtures(this.matches, now);
    // panels: [match, clock, match, clock, …]; null means the clock screen.
    const panels: Array<Match | null> = [];
    for (const m of fixtures.list) panels.push(m, null);
    if (panels.length === 0) panels.push(null);
    const panel = panels[Math.floor(t / this.cfg.rotateSec) % panels.length]!;
    if (panel === null) drawIdle(this.canvas, now, t);
    else drawKickoff(this.canvas, panel, now);
    return true;
  }

  /** Synthetic match clock: "68:24" ticking locally, "45+2" in stoppage. */
  private clockLabel(m: Match): string {
    if (m.minute == null) return "LIVE";
    if (m.extra != null) return `${m.minute}+${m.extra}`;
    const anchor = this.clockAnchor.get(m.id) ?? { minute: m.minute, at: nowSec() };
    const total = anchor.minute * 60 + Math.max(0, nowSec() - anchor.at);
    const min = Math.floor(total / 60);
    const sec = Math.floor(total % 60);
    return `${min}:${sec < 10 ? "0" : ""}${sec}`;
  }
}

function nowSec(): number {
  return performance.now() / 1000;
}
