import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { alignLyrics, findLyrics, startSeparation } from "../../lib/pipeline";

interface IngestRequest {
  title: string;
  artist: string;
  /** Publicly fetchable URL of the lawfully acquired audio (object storage). */
  audioUrl?: string;
  durationSeconds?: number;
}

/**
 * Kick off ingestion for one song: look up timed lyrics, start stem
 * separation if a provider is configured, and report what's still manual.
 * The response is the job plan + every artifact gathered so far; persisting
 * the results into the library is the deploy step (see README "Ingestion").
 */
export async function POST(request: NextRequest) {
  let body: IngestRequest;
  try {
    body = (await request.json()) as IngestRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.title?.trim() || !body.artist?.trim()) {
    return NextResponse.json({ error: "title and artist are required" }, { status: 400 });
  }

  const lyrics = await findLyrics(
    body.artist.trim(),
    body.title.trim(),
    body.durationSeconds,
  ).catch(() => null);
  const separation = body.audioUrl
    ? await startSeparation(body.audioUrl)
    : ({ started: false, reason: "no audioUrl provided" } as const);

  return NextResponse.json({
    song: { title: body.title.trim(), artist: body.artist.trim() },
    steps: {
      lyrics: lyrics
        ? {
            status: lyrics.synced ? "synced" : lyrics.plain ? "plain-only" : "not-found",
            ...lyrics,
          }
        : { status: "not-found" },
      separation,
      alignment: lyrics?.synced
        ? { status: "unnecessary", reason: "synced lyrics already found" }
        : alignLyrics(),
    },
    next:
      "Persist artifacts under public/library/<id>/ (vocals + backing stems, lyrics.lrc) " +
      "and add the song to public/library/index.json — see README.",
  });
}
