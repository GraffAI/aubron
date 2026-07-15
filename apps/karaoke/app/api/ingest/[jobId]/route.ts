import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { finalizeJob, readJob, writeJob } from "../../../lib/ingest";
import { getPrediction, pickStems } from "../../../lib/pipeline";
import { isStorageConfigured } from "../../../lib/storage";

// Finalizing downloads stems from the provider and re-uploads to the bucket.
export const maxDuration = 300;

/**
 * Poll an ingest job. While the separation provider is working this is a
 * cheap status check; on success the same request finalizes the song into
 * the library (stems copied into the private bucket, manifest updated).
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
  if (job.status !== "separating") {
    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      songId: job.songId,
      error: job.error,
    });
  }

  try {
    if (!job.predictionUrl) {
      const done = await finalizeJob(job, {});
      return NextResponse.json({ jobId: done.id, status: done.status, songId: done.songId });
    }
    const prediction = await getPrediction(job.predictionUrl);
    if (prediction.status === "starting" || prediction.status === "processing") {
      return NextResponse.json({ jobId: job.id, status: "separating" });
    }
    if (prediction.status !== "succeeded") {
      const failed = {
        ...job,
        status: "error" as const,
        error: prediction.error ?? `separation ${prediction.status}`,
      };
      await writeJob(failed);
      return NextResponse.json({ jobId: job.id, status: "error", error: failed.error });
    }
    const stems = pickStems(prediction.output);
    if (!stems.vocals && !stems.instrumental) {
      const failed = {
        ...job,
        status: "error" as const,
        error: "unrecognized separation output shape",
      };
      await writeJob(failed);
      return NextResponse.json({ jobId: job.id, status: "error", error: failed.error });
    }
    const done = await finalizeJob(job, stems);
    return NextResponse.json({ jobId: done.id, status: done.status, songId: done.songId });
  } catch (err) {
    // Transient (network, provider hiccup): report but leave the job
    // separating so the next poll can retry.
    return NextResponse.json(
      {
        jobId: job.id,
        status: "separating",
        note: err instanceof Error ? err.message : "retrying",
      },
      { status: 200 },
    );
  }
}
