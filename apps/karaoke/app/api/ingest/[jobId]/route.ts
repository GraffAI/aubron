import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { ElevenLabsError, elevenLabsAlign, elevenLabsTranscribe } from "../../../lib/elevenlabs";
import { applyAlignment, finalizeJob, readJob, writeJob } from "../../../lib/ingest";
import {
  alignmentProvider,
  flattenWhisperWords,
  getPrediction,
  pickStems,
  startAlignment,
  whisperxToLrc,
} from "../../../lib/pipeline";
import { alignedWordsToLrc, retimeLyrics, wordsToLrc } from "../../../lib/retime";
import { getObjectBytes, isStorageConfigured, presignGet } from "../../../lib/storage";
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
    const provider = alignmentProvider();
    if (provider === "elevenlabs") {
      // Synchronous provider: hand off to the aligning phase, which does the
      // call on the next poll (keeps this response snappy).
      const aligning: IngestJob = {
        ...done,
        status: "aligning",
        alignProvider: "elevenlabs",
        alignAudioKey: done.storedStems.vocals,
      };
      await writeJob(aligning);
      return NextResponse.json({ jobId: job.id, status: "aligning", songId: done.songId });
    }
    if (provider === "replicate") {
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
          alignProvider: "replicate",
          alignPredictionUrl: start.job.predictionUrl,
        };
        await writeJob(aligning);
        return NextResponse.json({ jobId: job.id, status: "aligning", songId: done.songId });
      }
      await applyAlignment(done.songId, null, `word timing not started: ${start.reason}`);
    } else {
      await applyAlignment(done.songId, null, "word timing skipped: no provider configured");
    }
  } else if (job.align && done.songId) {
    await applyAlignment(done.songId, null, "word timing skipped: no vocal stem stored");
  }
  return NextResponse.json({ jobId: job.id, status: "done", songId: done.songId });
}

async function pollAlignment(job: IngestJob) {
  const songId = job.songId ?? job.targetSongId;
  if (!songId) {
    await writeJob({ ...job, status: "done" });
    return NextResponse.json({ jobId: job.id, status: "done", songId });
  }
  if (job.alignProvider === "elevenlabs") return alignWithElevenLabs(job, songId);
  if (!job.alignPredictionUrl) {
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
  } else if (job.seedPlain) {
    // Timing transplant: the chosen lyric text stays the truth; Whisper only
    // contributes timestamps. Falls back to nothing (not to Whisper's own
    // words) when too little matches — a mismatched sheet is the likely cause.
    const lrc = retimeLyrics(job.seedPlain, flattenWhisperWords(prediction.output));
    await applyAlignment(
      songId,
      lrc,
      lrc
        ? "chosen lyrics retimed via WhisperX transplant"
        : "retiming rejected: Whisper heard too little of the chosen lyrics (wrong sheet?)",
    );
  } else {
    const lrc = whisperxToLrc(prediction.output);
    await applyAlignment(
      songId,
      lrc,
      lrc
        ? "transcribed + word-timed via WhisperX (no lyric sheet to seed)"
        : "word timing produced unrecognized output",
    );
  }
  await writeJob({ ...job, status: "done", songId });
  return NextResponse.json({ jobId: job.id, status: "done", songId });
}

/**
 * ElevenLabs is synchronous: this poll request does the actual work. With a
 * chosen sheet it's TRUE forced alignment (the text goes to the model, every
 * word of it comes back timestamped — retimeLyrics then just formats, since
 * ~everything anchors). Without a sheet, Scribe transcribes with word
 * timestamps and heuristic line breaks. 4xx errors are fatal (bad key, bad
 * input) and settle the job; transient errors bubble to the retry catch.
 */
async function alignWithElevenLabs(job: IngestJob, songId: string) {
  const finish = async (lrc: string | null, note: string) => {
    await applyAlignment(songId, lrc, note);
    await writeJob({ ...job, status: "done", songId });
    return NextResponse.json({ jobId: job.id, status: "done", songId });
  };
  const audio = await getObjectBytes(job.alignAudioKey ?? job.key);
  if (!audio) return finish(null, "word timing skipped: vocal stem missing from storage");
  try {
    if (job.seedPlain) {
      const words = await elevenLabsAlign(audio, job.seedPlain);
      // Direct cursor mapping first (script-agnostic — spaceless Japanese and
      // RTL Arabic included); fuzzy transplant as the shape-mismatch fallback.
      const lrc = alignedWordsToLrc(job.seedPlain, words) ?? retimeLyrics(job.seedPlain, words);
      return finish(
        lrc,
        lrc
          ? "chosen lyrics force-aligned via ElevenLabs"
          : "alignment rejected: too few words matched the audio (wrong sheet?)",
      );
    }
    const words = await elevenLabsTranscribe(audio);
    const lrc = wordsToLrc(words);
    return finish(
      lrc,
      lrc ? "transcribed + word-timed via ElevenLabs Scribe" : "transcription heard no words",
    );
  } catch (err) {
    if (err instanceof ElevenLabsError && err.fatal) {
      return finish(null, `word timing failed: ${err.message}`);
    }
    throw err; // transient — outer catch leaves the job aligning for a retry
  }
}
