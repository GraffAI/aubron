/**
 * The normalized match model the renderer and engine speak. Every data provider
 * maps its own payload onto this shape (see `providers/`), so the rest of the
 * codebase never sees provider-specific JSON.
 */
import type { Team } from "./teams.js";

export type MatchStatus =
  | "scheduled" // kickoff in the future
  | "live" // ball in play (first/second half, extra time)
  | "halftime" // paused between halves
  | "finished"; // full time / after extra time / after penalties

export interface SideScore {
  readonly team: Team;
  readonly score: number;
}

/**
 * A penalty shootout, when a knockout is level after extra time. The `goals`
 * scoreline stays frozen at the after-extra-time draw — the decider lives only
 * here. `home`/`away` are the running count of converted kicks; `homeKicks`/
 * `awayKicks` are each kick's outcome in order (true = scored), so the sign can
 * draw the traditional row of green/red dots.
 */
export interface Shootout {
  readonly home: number;
  readonly away: number;
  readonly homeKicks: readonly boolean[];
  readonly awayKicks: readonly boolean[];
}

export interface Match {
  readonly id: string;
  readonly status: MatchStatus;
  /** Elapsed minutes when live, else undefined. */
  readonly minute?: number;
  /** Stoppage-time minutes added on (minute 45 + extra 2 → "45+2"). */
  readonly extra?: number;
  /** Kickoff time (ISO) — used for countdowns when scheduled. */
  readonly kickoff?: string;
  readonly home: SideScore;
  readonly away: SideScore;
  /** Optional stage label, e.g. "GROUP A", "FINAL". */
  readonly stage?: string;
  /** Present when the tie went to (or was decided by) a penalty shootout. */
  readonly shootout?: Shootout;
}

export function isActive(status: MatchStatus): boolean {
  return status === "live" || status === "halftime";
}
