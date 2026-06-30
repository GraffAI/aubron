/**
 * API-Football (api-sports.io) provider. Its free tier carries **real-time**
 * live scores (~15s updates) for the World Cup (league id 1, season 2026), which
 * football-data's free tier does not — at the cost of a 100-requests/day cap. So
 * poll sparingly and only around live windows (the engine's adaptive interval
 * handles this).
 *
 * Auth: header `x-apisports-key`. Docs: api-football.com/documentation-v3
 */
import type { MatchStatus, Shootout } from "../model.js";
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
  score?: { penalty?: { home: number | null; away: number | null } };
}

/** A single event from the fixtures/events endpoint — only the shootout-relevant fields. */
interface AfEvent {
  type: string;
  detail: string;
  comments: string | null;
  team: { name: string };
}

function mapStatus(short: string): MatchStatus | null {
  if (["1H", "2H", "ET", "BT", "P", "LIVE", "INT"].includes(short)) return "live";
  if (short === "HT") return "halftime";
  if (["FT", "AET", "PEN"].includes(short)) return "finished";
  if (["NS", "TBD"].includes(short)) return "scheduled";
  return null; // PST / CANC / ABD / SUSP / AWD / WO — skip
}

/** A penalty shootout is in progress (`P`) or has just decided the tie (`PEN`). */
function isShootout(short: string): boolean {
  return short === "P" || short === "PEN";
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

/**
 * Turn the fixtures/events feed into ordered per-team kick outcomes. Shootout
 * kicks come through as `type:"Goal"`, `comments:"Penalty Shootout"`, with
 * `detail` either "Penalty" (scored) or "Missed Penalty" (missed); they arrive
 * in taking order (home, away, home, …). Returns undefined if the feed carries
 * no shootout kicks yet (the first taker hasn't stepped up).
 */
function parseShootout(
  events: AfEvent[],
  homeName: string,
  awayName: string,
): Shootout | undefined {
  const homeKicks: boolean[] = [];
  const awayKicks: boolean[] = [];
  for (const e of events) {
    if (e.type !== "Goal" || e.comments !== "Penalty Shootout") continue;
    const scored = e.detail !== "Missed Penalty";
    if (e.team.name === homeName) homeKicks.push(scored);
    else if (e.team.name === awayName) awayKicks.push(scored);
  }
  if (homeKicks.length === 0 && awayKicks.length === 0) return undefined;
  return {
    homeKicks,
    awayKicks,
    home: homeKicks.filter(Boolean).length,
    away: awayKicks.filter(Boolean).length,
  };
}

export function apiFootballProvider(
  apiKey: string,
  opts: { league?: number; season?: number } = {},
): Provider {
  const league = opts.league ?? 1;
  const season = opts.season ?? 2026;
  const headers = { "x-apisports-key": apiKey };

  // The per-kick dot pattern needs a second endpoint (fixtures/events), which
  // costs an extra request against the 100/day cap. Cache it per fixture: a
  // finished (`PEN`) shootout never changes, and an in-progress (`P`) one only
  // needs a refetch when its aggregate penalty count advances — i.e. roughly one
  // events call per kick, not one per poll. `agg` is the last-seen total of
  // converted kicks that the cheap fixtures call already reports.
  const cache = new Map<string, { agg: number; final: boolean; shootout?: Shootout }>();

  async function shootoutFor(f: AfFixture): Promise<Shootout | undefined> {
    const id = String(f.fixture.id);
    const pen = f.score?.penalty ?? { home: null, away: null };
    const agg = (pen.home ?? 0) + (pen.away ?? 0);
    const finished = f.fixture.status.short === "PEN";
    const cached = cache.get(id);
    if (cached && (cached.final || cached.agg === agg)) return cached.shootout;
    try {
      const data = (await getJson(`${BASE}/fixtures/events?fixture=${id}`, headers)) as {
        response?: AfEvent[];
      };
      const shootout = parseShootout(data.response ?? [], f.teams.home.name, f.teams.away.name);
      cache.set(id, { agg, final: finished, shootout });
      return shootout;
    } catch {
      // Events fetch failed — fall back to the (frozen) scoreline rather than
      // throwing the whole poll away. Don't cache, so the next poll retries.
      return cached?.shootout;
    }
  }

  return {
    name: "api-football",
    async fetchMatches() {
      const url = `${BASE}/fixtures?league=${league}&season=${season}`;
      const data = (await getJson(url, headers)) as { response?: AfFixture[] };
      const fixtures = (data.response ?? []).filter((f) => mapStatus(f.fixture.status.short));

      // Resolve dot patterns for any shootouts (usually zero, rarely one) before
      // building, so the kicks ride on the Match. Concurrent — there's seldom
      // more than one in flight.
      const shootouts = new Map<string, Shootout | undefined>();
      await Promise.all(
        fixtures
          .filter((f) => isShootout(f.fixture.status.short))
          .map(async (f) => shootouts.set(String(f.fixture.id), await shootoutFor(f))),
      );

      return fixtures.map((f) =>
        buildMatch({
          id: String(f.fixture.id),
          status: mapStatus(f.fixture.status.short)!,
          minute: f.fixture.status.elapsed ?? undefined,
          extra: f.fixture.status.extra ?? undefined,
          kickoff: f.fixture.date,
          stage: stageFromRound(f.league.round),
          home: { name: f.teams.home.name, score: f.goals.home ?? 0 },
          away: { name: f.teams.away.name, score: f.goals.away ?? 0 },
          shootout: shootouts.get(String(f.fixture.id)),
        }),
      );
    },
  };
}
