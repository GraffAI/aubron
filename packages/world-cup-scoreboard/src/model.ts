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
}

export function isActive(status: MatchStatus): boolean {
  return status === "live" || status === "halftime";
}
