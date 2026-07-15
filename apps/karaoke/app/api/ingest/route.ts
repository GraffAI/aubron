import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { finalizeJob, writeJob } from "../../lib/ingest";
import { findLyrics, isSeparationConfigured, startSeparation } from "../../lib/pipeline";
import { isStorageConfigured, presignGet } from "../../lib/storage";
import type { IngestJob } from "../../lib/types";

// Finalizing may download + re-upload stems; give the function room.
export const maxDuration = 300;

interface IngestRequest {
  /** Bucket key of the uploaded original (from POST /api/upload). */
  key: string;
  title: string;
  artist: string;
  durationSeconds?: number;
}

/**
 * Autonomous ingestion: uploaded original in the private bucket → timed
 * lyrics (LRCLIB) → stem separation (when configured) → library entry. The
 * job is persisted in the bucket so any serverless instance can carry a poll
 * forward (GET /api/ingest/<jobId>). Without a separation provider the song
 * still lands in the library with the full mix as backing.
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

  const lyrics = await findLyrics(
    body.artist.trim(),
    body.title.trim(),
    body.durationSeconds,
  ).catch(() => null);

  const job: IngestJob = {
    id: crypto.randomUUID(),
    key: body.key,
    title: body.title.trim(),
    artist: body.artist.trim(),
    duration: body.durationSeconds ?? 0,
    lrc: lyrics?.synced ?? null,
    predictionUrl: null,
    status: "separating",
  };

  let separationNote = "";
  if (isSeparationConfigured()) {
    // The provider gets a short-lived read URL for this one original —
    // the only time anything in the bucket is reachable from outside.
    const start = await startSeparation(await presignGet(job.key)).catch((err: unknown) => ({
      started: false as const,
      reason: err instanceof Error ? err.message : "separation request failed",
    }));
    if (start.started) job.predictionUrl = start.job.predictionUrl;
    else separationNote = start.reason;
  } else {
    separationNote = "no separation provider configured — full mix stored as backing";
  }

  if (!job.predictionUrl) {
    // Nothing to wait for: finalize now with the original as the backing track.
    const done = await finalizeJob(job, {});
    return NextResponse.json({
      jobId: done.id,
      status: done.status,
      songId: done.songId,
      lyrics: job.lrc ? "synced" : "none",
      separation: `skipped: ${separationNote}`,
    });
  }

  await writeJob(job);
  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    lyrics: job.lrc ? "synced" : "none",
  });
}
