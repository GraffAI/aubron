import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { writeJob } from "../../../../lib/ingest";
import { isAlignmentConfigured, startAlignment } from "../../../../lib/pipeline";
import { lyricsToPlainLines } from "../../../../lib/retime";
import { getJson, isStorageConfigured, presignGet } from "../../../../lib/storage";
import type { IngestJob, StoredLibraryEntry } from "../../../../lib/types";

/**
 * Word-time an existing song with WhisperX — the "I got an LRCLIB hit but I
 * want word-level timing" (or "line timing looks off") button. Runs over the
 * stored vocal stem and, crucially, SEEDS with the song's existing lyric
 * text: Whisper contributes timestamps only (timing transplant), it does not
 * replace the words. Poll the returned job on GET /api/ingest/<jobId>; on
 * failure the song keeps what it had.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ songId: string }> },
) {
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "library storage not configured" }, { status: 503 });
  }
  if (!isAlignmentConfigured()) {
    return NextResponse.json(
      { error: "word timing not configured (set REPLICATE_WHISPERX_VERSION)" },
      { status: 503 },
    );
  }
  const { songId } = await params;
  const entries = (await getJson<StoredLibraryEntry[]>("library/index.json")) ?? [];
  const entry = entries.find((e) => e.id === songId);
  if (!entry) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!entry.stems.vocals) {
    return NextResponse.json(
      { error: "no vocal stem stored — reprocess with separation first" },
      { status: 409 },
    );
  }

  const start = await startAlignment(await presignGet(entry.stems.vocals));
  if (!start.started) {
    return NextResponse.json({ error: start.reason }, { status: 502 });
  }
  const seedText = entry.providerLrc ?? entry.lrc;
  const job: IngestJob = {
    id: crypto.randomUUID(),
    key: entry.stems.vocals,
    title: entry.title,
    artist: entry.artist,
    duration: entry.duration,
    lrc: entry.lrc,
    predictionUrl: null,
    align: true,
    seedPlain: seedText ? lyricsToPlainLines(seedText).join("\n") : null,
    alignPredictionUrl: start.job.predictionUrl,
    songId,
    targetSongId: songId,
    status: "aligning",
  };
  await writeJob(job);
  return NextResponse.json({ jobId: job.id, status: job.status, songId });
}
