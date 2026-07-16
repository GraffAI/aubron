import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ingestReportKey, launchJob } from "../../../../lib/ingest";
import { findLyrics, isAlignmentConfigured } from "../../../../lib/pipeline";
import { deleteObject, getJson, isStorageConfigured } from "../../../../lib/storage";
import type { IngestJob, IngestReport, StoredLibraryEntry } from "../../../../lib/types";

// Reprocess may finalize inline (no separation provider): give it room.
export const maxDuration = 300;

/**
 * Re-run the whole pipeline for an existing song from its retained original —
 * fresh separation AND a fresh lyric lookup — updating the song in place
 * (same id, same URLs). This is how entries ingested before a feature landed
 * (e.g. the full-mix crossfade stem) get upgraded without re-uploading, and
 * how a bad separation gets a second try. Poll the returned job on
 * GET /api/ingest/<jobId> exactly like a first ingest.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ songId: string }> },
) {
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "library storage not configured" }, { status: 503 });
  }
  const { songId } = await params;
  const entries = (await getJson<StoredLibraryEntry[]>("library/index.json")) ?? [];
  const entry = entries.find((e) => e.id === songId);
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });

  const report = await getJson<IngestReport>(ingestReportKey(songId)).catch(() => null);
  if (!report?.originalKey) {
    return NextResponse.json(
      { error: "original audio not retained for this song (ingested before reprocess support)" },
      { status: 409 },
    );
  }

  // Old stems can change extension across runs; clear them so nothing orphans.
  // (.flat() reaches into stems.extras — a string[] that a plain typeof
  // filter would silently drop, orphaning backing2/backing3 forever.)
  await Promise.all(
    Object.values(entry.stems)
      .flat()
      .filter((k): k is string => typeof k === "string")
      .map(deleteObject),
  );

  const lyrics = await findLyrics(entry.artist, entry.title, entry.duration || undefined);
  const job: IngestJob = {
    id: crypto.randomUUID(),
    key: report.originalKey,
    title: entry.title,
    artist: entry.artist,
    duration: entry.duration,
    lrc: lyrics.synced ?? entry.lrc, // a lookup miss shouldn't erase working lyrics
    lyrics,
    predictionUrl: null,
    // Same fallback rule as first ingest: no synced lyrics → word-time.
    align: isAlignmentConfigured() && lyrics.synced === null && !entry.lrc,
    targetSongId: songId,
    status: "separating",
  };
  const launched = await launchJob(job);
  return NextResponse.json({
    jobId: launched.id,
    status: launched.status,
    songId: launched.songId ?? songId,
    lyrics: lyrics.status,
    ...(launched.separationNote ? { separation: `skipped: ${launched.separationNote}` } : {}),
  });
}
