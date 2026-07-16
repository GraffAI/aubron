import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { applyAlignment, finalizeJob, readJob, writeJob } from "../../../lib/ingest";
import { getPrediction, pickStems, startAlignment, whisperxToLrc } from "../../../lib/pipeline";
import { isStorageConfigured, presignGet } from "../../../lib/storage";
import type { IngestJob } from "../../../lib/types";

// Finalizing downloads stems from the provider and re-uploads to the bucket.
export const maxDuration = 300;

/**
 * Poll an ingest job through its phases:
 *
 *   separating ──(demucs done → stems stored, song live)──► aligning? ──► done
 *
 * Word timing (WhisperX over the stored vocal stem) runs AFTER finalize, so
 * the song is playable the moment separation lands and alignment can only
 * improve it. An alignment failure never fails the song — it keeps whatever
 * lyrics it already has, and the report says what happened.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: "library storage not configured" }, { status: 503 });
  }
  const { jobId } = await params;
  const job = await readJob(jobId);
  if (!job) return NextResponse.json({ error: "unknown job" }, { status: 404 });
  if (job.status === "done" || job.status === "error") {
    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      songId: job.songId,
      error: job.error,
    });
  }

  try {
    if (job.status === "separating") return await pollSeparation(job);
    return await pollAlignment(job);
  } catch (err) {
    // Transient (network, provider hiccup): report but leave the job
    // where it is so the next poll can retry.
    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      songId: job.songId,
      note: err instanceof Error ? err.message : "retrying",
    });
  }
}

async function pollSeparation(job: IngestJob) {
  const fail = async (error: string) => {
    await writeJob({ ...job, status: "error", error });
    return NextResponse.json({ jobId: job.id, status: "error", error });
  };

  let stems: { vocals?: string; instrumental?: string } = {};
  if (job.predictionUrl) {
    const prediction = await getPrediction(job.predictionUrl);
    if (prediction.status === "starting" || prediction.status === "processing") {
      return NextResponse.json({ jobId: job.id, status: "separating" });
    }
    if (prediction.status !== "succeeded") {
      return fail(prediction.error ?? `separation ${prediction.status}`);
    }
    stems = pickStems(prediction.output);
    if (!stems.vocals && !stems.instrumental) return fail("unrecognized separation output shape");
  }

  const done = await finalizeJob(job, stems);

  // Song is live; word timing is an upgrade pass over the stored vocal stem.
  if (job.align && done.storedStems?.vocals && done.songId) {
    const start = await startAlignment(await presignGet(done.storedStems.vocals)).catch(
      (err: unknown) => ({
        started: false as const,
        reason: err instanceof Error ? err.message : "alignment request failed",
      }),
    );
    if (start.started) {
      const aligning: IngestJob = {
        ...done,
        status: "aligning",
        alignPredictionUrl: start.job.predictionUrl,
      };
      await writeJob(aligning);
      return NextResponse.json({ jobId: job.id, status: "aligning", songId: done.songId });
    }
    await applyAlignment(done.songId, null, `word timing not started: ${start.reason}`);
  } else if (job.align && done.songId) {
    await applyAlignment(done.songId, null, "word timing skipped: no vocal stem stored");
  }
  return NextResponse.json({ jobId: job.id, status: "done", songId: done.songId });
}

async function pollAlignment(job: IngestJob) {
  const songId = job.songId ?? job.targetSongId;
  if (!job.alignPredictionUrl || !songId) {
    await writeJob({ ...job, status: "done" });
    return NextResponse.json({ jobId: job.id, status: "done", songId });
  }
  const prediction = await getPrediction(job.alignPredictionUrl);
  if (prediction.status === "starting" || prediction.status === "processing") {
    return NextResponse.json({ jobId: job.id, status: "aligning", songId });
  }
  if (prediction.status !== "succeeded") {
    await applyAlignment(
      songId,
      null,
      `word timing failed: ${prediction.error ?? prediction.status}`,
    );
  } else {
    const lrc = whisperxToLrc(prediction.output);
    await applyAlignment(
      songId,
      lrc,
      lrc ? "word-timed via WhisperX" : "word timing produced unrecognized output",
    );
  }
  await writeJob({ ...job, status: "done", songId });
  return NextResponse.json({ jobId: job.id, status: "done", songId });
}
