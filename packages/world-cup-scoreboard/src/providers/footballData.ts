/**
 * football-data.org provider. Free tier covers the World Cup (competition code
 * `WC`) and gives clean three-letter `tla` codes — great for flag mapping — but
 * its scores are *delayed*, not truly live. Good as a free fallback / for
 * fixtures; prefer api-football for real-time goals. Free tier: 10 req/min.
 *
 * Docs: docs.football-data.org/general/v4/match.html
 */
import type { MatchStatus } from "../model.js";
import { buildMatch, getJson, shortStage, type Provider } from "./types.js";

const BASE = "https://api.football-data.org/v4";

interface FdTeam {
  tla?: string;
  shortName?: string;
  name?: string;
}
interface FdMatch {
  id: number;
  utcDate: string;
  status: string;
  minute?: number;
  stage?: string;
  homeTeam: FdTeam;
  awayTeam: FdTeam;
  score: { fullTime: { home: number | null; away: number | null } };
}

function mapStatus(s: string): MatchStatus | null {
  switch (s) {
    case "IN_PLAY":
      return "live";
    case "PAUSED":
      return "halftime";
    case "FINISHED":
    case "AWARDED":
      return "finished";
    case "SCHEDULED":
    case "TIMED":
      return "scheduled";
    default:
      return null; // POSTPONED / SUSPENDED / CANCELLED — skip
  }
}

function teamName(t: FdTeam): string {
  return t.shortName ?? t.name ?? t.tla ?? "???";
}

export function footballDataProvider(apiKey: string, competition = "WC"): Provider {
  return {
    name: "football-data.org",
    async fetchMatches() {
      const url = `${BASE}/competitions/${competition}/matches`;
      const data = (await getJson(url, { "X-Auth-Token": apiKey })) as { matches?: FdMatch[] };
      const out = [];
      for (const m of data.matches ?? []) {
        const status = mapStatus(m.status);
        if (!status) continue;
        out.push(
          buildMatch({
            id: String(m.id),
            status,
            minute: m.minute,
            kickoff: m.utcDate,
            stage: shortStage(m.stage),
            home: {
              code: m.homeTeam.tla,
              name: teamName(m.homeTeam),
              score: m.score.fullTime.home ?? 0,
            },
            away: {
              code: m.awayTeam.tla,
              name: teamName(m.awayTeam),
              score: m.score.fullTime.away ?? 0,
            },
          }),
        );
      }
      return out;
    },
  };
}
