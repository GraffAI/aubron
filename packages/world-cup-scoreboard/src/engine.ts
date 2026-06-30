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

/**
 * The payload handed to the `onGoal` hook when a celebration starts on screen —
 * enough for an external system (e.g. a Home Assistant webhook) to react, like
 * casting a goal horn to a Nest Hub. Scores are the post-goal scoreline.
 *
 * `leadChange` flags the goals that also moved the lead (taken, overtaken or
 * pegged back to level) — the only ones the announcer voice narrates; every goal
 * still gets the horn.
 */
export interface GoalAnnouncement {
  competition: string;
  matchId: string;
  /** Scoring team's FIFA code and display name (handy for TTS). */
  team: string;
  teamName: string;
  home: string;
  away: string;
  /** Both teams' display names, so a spoken line can name the opponent. */
  homeName: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  /** Match minute when the goal landed, if known. */
  minute: number | null;
  /** Did this goal change who's leading (a new leader, or back to level)? */
  leadChange: boolean;
}

/**
 * The payload handed to the `onMatchEnd` hook at full time — enough to narrate
 * the result (a win or a draw). Scores are the final scoreline.
 */
export interface MatchResult {
  competition: string;
  matchId: string;
  home: string;
  away: string;
  homeName: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  /** Penalty-shootout tally when the tie was decided on spot kicks, else null. */
  pens: { home: number; away: number } | null;
}

/** Who's ahead in a scoreline, from the home team's point of view. */
type Leader = "home" | "away" | "level";

function leader(home: number, away: number): Leader {
  return home > away ? "home" : away > home ? "away" : "level";
}

/** Build the `onGoal` payload from a freshly-scored match. */
export function goalAnnouncement(
  m: Match,
  team: Team,
  competition: string,
  leadChange: boolean,
): GoalAnnouncement {
  return {
    competition,
    matchId: m.id,
    team: team.code,
    teamName: team.name,
    home: m.home.team.code,
    away: m.away.team.code,
    homeName: m.home.team.name,
    awayName: m.away.team.name,
    homeScore: m.home.score,
    awayScore: m.away.score,
    minute: m.minute ?? null,
    leadChange,
  };
}

/** Build the `onMatchEnd` payload from a finished match. */
export function matchResult(m: Match, competition: string): MatchResult {
  return {
    competition,
    matchId: m.id,
    home: m.home.team.code,
    away: m.away.team.code,
    homeName: m.home.team.name,
    awayName: m.away.team.name,
    homeScore: m.home.score,
    awayScore: m.away.score,
    pens: m.shootout ? { home: m.shootout.home, away: m.shootout.away } : null,
  };
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
 * The matches to rotate through right now.
 *
 * Live games take over completely: while anything is in play we show *only* the
 * active matches (most-advanced first). The pre-match countdowns and the
 * post-FT grace period only fill the gaps — when nothing is live we rotate the
 * window: upcoming-soonest first, then most-recently finished. Empty → the
 * engine drops to the idle fixture rotation.
 */
export function selectDisplaySet(
  matches: Match[],
  now: Date,
  cfg: Pick<Config, "upcomingWithinMin" | "finishedLingerMin">,
): Match[] {
  const active = matches
    .filter((m) => isActive(m.status))
    .sort((a, b) => rank(a) - rank(b) || (b.minute ?? 0) - (a.minute ?? 0));
  if (active.length > 0) return active;

  const phase = (m: Match): number => (m.status === "scheduled" ? 0 : 1);
  return matches
    .filter((m) => inWindow(m, now, cfg))
    .sort(
      (a, b) =>
        phase(a) - phase(b) ||
        (a.status === "scheduled"
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

/**
 * Did the team in front change between two views of the same match? True when a
 * lead is taken, overtaken, or pegged back to level — the goals the announcer
 * voice narrates (vs. an extending-the-lead goal, which only gets the horn).
 */
export function leadChanged(prev: Match | undefined, next: Match): boolean {
  if (!prev || prev.id !== next.id) return false;
  return leader(prev.home.score, prev.away.score) !== leader(next.home.score, next.away.score);
}

/** Detect the moment a match reaches full time (a fresh transition to finished). */
export function detectFinish(prev: Match | undefined, next: Match): boolean {
  if (!prev || prev.id !== next.id) return false;
  return prev.status !== "finished" && next.status === "finished";
}

export interface EngineHooks {
  /** Called with each rendered frame; default streams it over DDP. */
  onFrame?: (canvas: Canvas) => void;
  /**
   * Called once when a goal celebration starts on screen (not at detection — so
   * it lands with the celebration even when goals are queued back-to-back).
   * Fire-and-forget: it must not throw or block the render loop.
   */
  onGoal?: (a: GoalAnnouncement) => void;
  /**
   * Called once when a match reaches full time, for the spoken result line.
   * Fired at poll time (results have no on-screen celebration). Fire-and-forget.
   */
  onMatchEnd?: (r: MatchResult) => void;
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
  private readonly onGoal?: (a: GoalAnnouncement) => void;
  private readonly onMatchEnd?: (r: MatchResult) => void;

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
  /** Pending goal celebrations, played back-to-back (so simultaneous goals in
   * different matches don't clobber each other). */
  private goalQueue: Array<{ team: Team; matchId: string; announce: GoalAnnouncement }> = [];
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
    this.onGoal = hooks.onGoal;
    this.onMatchEnd = hooks.onMatchEnd;
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
        const prev = this.prevByMatch.get(m.id);
        const goal = isActive(m.status) ? detectGoal(prev, m) : null;
        if (goal) {
          const lead = leadChanged(prev, m);
          // Queue it — render() plays celebrations one after another.
          this.goalQueue.push({
            team: goal.team,
            matchId: m.id,
            announce: goalAnnouncement(m, goal.team, this.cfg.competition, lead),
          });
          this.log(
            `GOAL! ${goal.team.code} (${m.home.team.code} ${m.home.score}-${m.away.score} ${m.away.team.code})${lead ? " [lead change]" : ""}`,
          );
        }
        // Full time → announce the result (win or draw). No celebration, so fire
        // it straight away rather than queueing behind the goal display.
        if (detectFinish(prev, m)) {
          this.log(`FT ${m.home.team.code} ${m.home.score}-${m.away.score} ${m.away.team.code}`);
          this.onMatchEnd?.(matchResult(m, this.cfg.competition));
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
    // The current celebration ended → make room for the next queued one.
    if (this.goalTeam && nowSec() - this.goalStartSec >= GOAL_DURATION) this.goalTeam = null;
    // Start the next queued goal; land the rotation on its match so it's the one
    // showing when the celebration ends.
    if (!this.goalTeam && this.goalQueue.length > 0) {
      const next = this.goalQueue.shift()!;
      this.goalTeam = next.team;
      this.goalStartSec = nowSec();
      this.focusId = next.matchId;
      // Tell any external listener (e.g. a Home Assistant webhook → Nest Hub
      // chime) the celebration is now on screen. Must never throw in here.
      this.onGoal?.(next.announce);
      const i = this.displaySet.findIndex((mm) => mm.id === next.matchId);
      if (i >= 0) {
        this.displayIdx = i;
        this.lastRotateSec = nowSec();
      }
    }
    if (this.goalTeam) {
      drawGoal(this.canvas, this.goalTeam, nowSec() - this.goalStartSec);
      return true;
    }

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
