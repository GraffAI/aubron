import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Multi-candidate lyric search for the picker step. Returns up to 8 distinct
 * sheets from LRCLIB (exact get + fuzzy search, deduped), each with enough
 * text to preview against the uploaded audio. More providers plug in here —
 * the response shape is provider-agnostic.
 */

interface LrclibHit {
  id?: number;
  artistName?: string;
  trackName?: string;
  albumName?: string;
  duration?: number;
  syncedLyrics: string | null;
  plainLyrics: string | null;
}

export interface LyricCandidate {
  id: string;
  source: string;
  artist: string;
  title: string;
  album: string;
  duration: number;
  timed: boolean;
  wordTimed: boolean;
  synced: string | null;
  plain: string | null;
}

function toCandidate(hit: LrclibHit, source: string): LyricCandidate {
  return {
    id: `lrclib-${hit.id ?? Math.random().toString(36).slice(2, 8)}`,
    source,
    artist: hit.artistName ?? "",
    title: hit.trackName ?? "",
    album: hit.albumName ?? "",
    duration: hit.duration ?? 0,
    timed: Boolean(hit.syncedLyrics),
    wordTimed: Boolean(hit.syncedLyrics && /<\d{1,3}:\d{1,2}/.test(hit.syncedLyrics)),
    synced: hit.syncedLyrics,
    plain: hit.plainLyrics,
  };
}

export async function GET(request: NextRequest) {
  const artist = request.nextUrl.searchParams.get("artist")?.trim();
  const title = request.nextUrl.searchParams.get("title")?.trim();
  const duration = Number(request.nextUrl.searchParams.get("duration")) || undefined;
  if (!artist || !title) {
    return NextResponse.json({ error: "artist and title are required" }, { status: 400 });
  }
  const headers = { "User-Agent": "aubron-karaoke (https://github.com/GraffAI/aubron)" };
  const candidates: LyricCandidate[] = [];
  const attempts: string[] = [];
  try {
    const get = new URL("https://lrclib.net/api/get");
    get.searchParams.set("artist_name", artist);
    get.searchParams.set("track_name", title);
    if (duration) get.searchParams.set("duration", String(Math.round(duration)));
    const exact = await fetch(get, { headers });
    attempts.push(`GET lrclib.net/api/get → ${exact.status}`);
    if (exact.ok)
      candidates.push(toCandidate((await exact.json()) as LrclibHit, "lrclib (exact match)"));

    const search = new URL("https://lrclib.net/api/search");
    search.searchParams.set("artist_name", artist);
    search.searchParams.set("track_name", title);
    const res = await fetch(search, { headers });
    const hits = res.ok ? ((await res.json()) as LrclibHit[]) : [];
    attempts.push(`GET lrclib.net/api/search → ${res.status} (${hits.length} hits)`);
    for (const hit of hits) candidates.push(toCandidate(hit, "lrclib (search)"));
  } catch (err) {
    attempts.push(`provider unreachable: ${err instanceof Error ? err.message : "error"}`);
  }

  // Dedupe by id and by identical lyric text; timed sheets first.
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const key = c.id + "|" + (c.synced ?? c.plain ?? "").slice(0, 400);
    if (seen.has(key) || (!c.synced && !c.plain)) return false;
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => Number(b.timed) - Number(a.timed));
  return NextResponse.json({ candidates: unique.slice(0, 8), attempts });
}
