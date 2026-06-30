/**
 * A data provider turns some upstream football API into our normalized `Match`
 * model. Implementations live alongside this file; the engine only ever sees
 * `Match[]` and never provider-specific JSON.
 */
import type { Match, MatchStatus, Shootout } from "../model.js";
import { resolveTeam } from "../teams.js";

export interface Provider {
  readonly name: string;
  /**
   * Return the World Cup matches worth showing right now — typically anything
   * live, plus upcoming-soon and just-finished fixtures. The engine decides
   * which single match to display.
   */
  fetchMatches(): Promise<Match[]>;
}

/** Helper for providers: assemble a `Match` from already-extracted fields. */
export function buildMatch(input: {
  id: string;
  status: MatchStatus;
  minute?: number;
  extra?: number;
  kickoff?: string;
  stage?: string;
  home: { code?: string; name: string; score: number };
  away: { code?: string; name: string; score: number };
  shootout?: Shootout;
}): Match {
  return {
    id: input.id,
    status: input.status,
    minute: input.minute,
    extra: input.extra,
    kickoff: input.kickoff,
    stage: input.stage,
    home: { team: resolveTeam(input.home), score: input.home.score },
    away: { team: resolveTeam(input.away), score: input.away.score },
    shootout: input.shootout,
  };
}

export async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

/** Normalize a stage/round label to a short uppercase token for the display. */
export function shortStage(raw?: string): string | undefined {
  if (!raw) return undefined;
  const map: Record<string, string> = {
    GROUP_STAGE: "GROUP",
    LAST_16: "R16",
    ROUND_OF_16: "R16",
    QUARTER_FINALS: "QTR",
    QUARTER_FINAL: "QTR",
    SEMI_FINALS: "SEMI",
    SEMI_FINAL: "SEMI",
    THIRD_PLACE: "3RD",
    FINAL: "FINAL",
  };
  const key = raw.toUpperCase().replace(/[\s-]+/g, "_");
  return map[key] ?? raw.toUpperCase().slice(0, 6);
}
