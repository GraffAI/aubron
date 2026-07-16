import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { applyAlignment, launchJob } from "../../lib/ingest";
import { findLyrics, isAlignmentConfigured } from "../../lib/pipeline";
import { isStorageConfigured } from "../../lib/storage";
import type { IngestJob } from "../../lib/types";

// Finalizing may download + re-upload stems; give the function room.
export const maxDuration = 300;

interface IngestRequest {
  /** Bucket key of the uploaded original (from POST /api/upload). */
  key: string;
  title: string;
  artist: string;
  durationSeconds?: number;
  /** Force WhisperX word timing even when LRCLIB returned synced lyrics. */
  align?: boolean;
}

/**
 * Autonomous ingestion: uploaded original in the private bucket → timed
 * lyrics (LRCLIB) → stem separation (when configured) → library entry →
 * optional WhisperX word timing over the vocal stem. Word timing runs when
 * explicitly requested OR as an automatic fallback when no synced lyrics
 * were found. The job is persisted in the bucket so any serverless instance
 * can carry a poll forward (GET /api/ingest/<jobId>).
 */
export async function POST(request: NextRequest) {
  if (!isStorageConfigured()) {
    return NextResponse.json(
      { error: "library storage not configured (see README: Storage)" },
      { status: 503 },
    );
  }
  let body: IngestRequest;
  try {
    body = (await request.json()) as IngestRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.title?.trim() || !body.artist?.trim() || !body.key?.startsWith("originals/")) {
    return NextResponse.json(
      { error: "key (originals/…), title and artist are required" },
      { status: 400 },
    );
  }

  const lyrics = await findLyrics(body.artist.trim(), body.title.trim(), body.durationSeconds);
  const wantAlign = body.align === true || lyrics.synced === null;
  const align = wantAlign && isAlignmentConfigured();

  const job: IngestJob = {
    id: crypto.randomUUID(),
    key: body.key,
    title: body.title.trim(),
    artist: body.artist.trim(),
    duration: body.durationSeconds ?? 0,
    lrc: lyrics.synced,
    lyrics,
    predictionUrl: null,
    align,
    status: "separating",
  };

  const launched = await launchJob(job);
  // Inline finalize (no separation provider) can't word-time: no vocal stem.
  if (launched.status === "done" && align && launched.songId && !launched.storedStems?.vocals) {
    await applyAlignment(launched.songId, null, "word timing skipped: no vocal stem stored");
  }
  return NextResponse.json({
    jobId: launched.id,
    status: launched.status,
    songId: launched.songId,
    lyrics: lyrics.status,
    align,
    ...(wantAlign && !align
      ? { alignNote: "word timing unavailable: REPLICATE_WHISPERX_VERSION not configured" }
      : {}),
    ...(launched.separationNote ? { separation: `skipped: ${launched.separationNote}` } : {}),
  });
}
