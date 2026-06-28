/**
 * API-Football (api-sports.io) provider. Its free tier carries **real-time**
 * live scores (~15s updates) for the World Cup (league id 1, season 2026), which
 * football-data's free tier does not — at the cost of a 100-requests/day cap. So
 * poll sparingly and only around live windows (the engine's adaptive interval
 * handles this).
 *
 * Auth: header `x-apisports-key`. Docs: api-football.com/documentation-v3
 */
import type { MatchStatus } from "../model.js";
import { buildMatch, getJson, type Provider } from "./types.js";

const BASE = "https://v3.football.api-sports.io";

interface AfTeam {
  name: string;
}
interface AfFixture {
  fixture: {
    id: number;
    date: string;
    status: { short: string; elapsed: number | null; extra: number | null };
  };
  league: { round?: string };
  teams: { home: AfTeam; away: AfTeam };
  goals: { home: number | null; away: number | null };
}

function mapStatus(short: string): MatchStatus | null {
  if (["1H", "2H", "ET", "BT", "P", "LIVE", "INT"].includes(short)) return "live";
  if (short === "HT") return "halftime";
  if (["FT", "AET", "PEN"].includes(short)) return "finished";
  if (["NS", "TBD"].includes(short)) return "scheduled";
  return null; // PST / CANC / ABD / SUSP / AWD / WO — skip
}

function stageFromRound(round?: string): string | undefined {
  if (!round) return undefined;
  const r = round.toLowerCase();
  if (r.includes("final") && !r.includes("semi") && !r.includes("quarter")) return "FINAL";
  if (r.includes("semi")) return "SEMI";
  if (r.includes("quarter")) return "QTR";
  if (r.includes("16")) return "R16";
  if (r.includes("group")) return "GROUP";
  return round.toUpperCase().slice(0, 6);
}

export function apiFootballProvider(
  apiKey: string,
  opts: { league?: number; season?: number } = {},
): Provider {
  const league = opts.league ?? 1;
  const season = opts.season ?? 2026;
  return {
    name: "api-football",
    async fetchMatches() {
      const url = `${BASE}/fixtures?league=${league}&season=${season}`;
      const data = (await getJson(url, { "x-apisports-key": apiKey })) as {
        response?: AfFixture[];
      };
      const out = [];
      for (const f of data.response ?? []) {
        const status = mapStatus(f.fixture.status.short);
        if (!status) continue;
        out.push(
          buildMatch({
            id: String(f.fixture.id),
            status,
            minute: f.fixture.status.elapsed ?? undefined,
            extra: f.fixture.status.extra ?? undefined,
            kickoff: f.fixture.date,
            stage: stageFromRound(f.league.round),
            home: { name: f.teams.home.name, score: f.goals.home ?? 0 },
            away: { name: f.teams.away.name, score: f.goals.away ?? 0 },
          }),
        );
      }
      return out;
    },
  };
}
