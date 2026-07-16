/**
 * Ingestion pipeline — the cloud side of "drop in a lawfully acquired MP3,
 * get a karaoke-ready song". Three provider slots:
 *
 * 1. LYRICS (implemented): LRCLIB (lrclib.net) — a free, keyless database of
 *    community-synced LRC lyrics. First choice because most popular tracks
 *    already have line-timed (sometimes word-timed) lyrics there.
 *
 * 2. SEPARATION (wired, needs a token): source separation — NOT diarization,
 *    which is "who spoke when"; we want "which *instrument* is which" — via
 *    Demucs (htdemucs) running on Replicate. Set REPLICATE_API_TOKEN and
 *    optionally REPLICATE_DEMUCS_VERSION. Alternatives with the same shape:
 *    LALAL.AI, Music.AI (Moises), AudioShake, or self-hosted demucs.
 *
 * 3. ALIGNMENT (stub): when only *untimed* lyrics exist, forced alignment
 *    (WhisperX or stable-ts over the isolated VOCAL stem — aligning against
 *    the vocal stem instead of the full mix is dramatically more accurate)
 *    produces word-level timings. Documented here, implemented when a
 *    provider is chosen.
 *
 * The pipeline returns artifacts; persisting them into public/library/ (or
 * object storage) is the deploy step described in the README.
 */

import type { LyricsReport } from "./types";

type LrclibHit = { syncedLyrics: string | null; plainLyrics: string | null };

/**
 * Timed-lyrics lookup, reported in full: every provider request and its
 * outcome lands in `attempts`, and failures become a status instead of an
 * exception — so "did lyrics work, and why not" is always answerable later.
 */
export async function findLyrics(
  artist: string,
  title: string,
  durationSeconds?: number,
): Promise<LyricsReport> {
  const report: LyricsReport = {
    status: "not-found",
    synced: null,
    plain: null,
    source: null,
    query: { artist, title, ...(durationSeconds ? { duration: Math.round(durationSeconds) } : {}) },
    attempts: [],
  };
  const headers = { "User-Agent": "aubron-karaoke (https://github.com/GraffAI/aubron)" };
  const finish = (hit: LrclibHit, source: string): LyricsReport => ({
    ...report,
    status: hit.syncedLyrics ? "synced" : hit.plainLyrics ? "plain-only" : "not-found",
    synced: hit.syncedLyrics,
    plain: hit.plainLyrics,
    source,
  });

  try {
    // Exact match first: artist + title (+ duration to pick the right version).
    const get = new URL("https://lrclib.net/api/get");
    get.searchParams.set("artist_name", artist);
    get.searchParams.set("track_name", title);
    if (durationSeconds) get.searchParams.set("duration", String(Math.round(durationSeconds)));
    const exact = await fetch(get, { headers });
    report.attempts.push(`GET lrclib.net/api/get → ${exact.status}`);
    if (exact.ok) return finish((await exact.json()) as LrclibHit, "lrclib:get");

    // Fuzzy fallback: search and prefer a synced result.
    const search = new URL("https://lrclib.net/api/search");
    search.searchParams.set("artist_name", artist);
    search.searchParams.set("track_name", title);
    const res = await fetch(search, { headers });
    const hits = res.ok ? ((await res.json()) as LrclibHit[]) : [];
    report.attempts.push(`GET lrclib.net/api/search → ${res.status} (${hits.length} hits)`);
    const best = hits.find((h) => h.syncedLyrics) ?? hits[0];
    if (best) return finish(best, "lrclib:search");
    return report;
  } catch (err) {
    report.attempts.push(`provider unreachable: ${err instanceof Error ? err.message : "error"}`);
    return { ...report, status: "error" };
  }
}

export interface SeparationJob {
  provider: "replicate";
  /** Poll this (with the same token) until status is "succeeded"; output has per-stem URLs. */
  predictionUrl: string;
}

export type SeparationStart =
  | { started: true; job: SeparationJob }
  | { started: false; reason: string };

// Overridable so integration tests can stand in for Replicate.
const replicateBase = () => process.env.REPLICATE_API_BASE ?? "https://api.replicate.com";

export function isSeparationConfigured(): boolean {
  return Boolean(process.env.REPLICATE_API_TOKEN && process.env.REPLICATE_DEMUCS_VERSION);
}

/**
 * Build the separation request input. Defaults speak the ryan5453/demucs
 * dialect (`two_stems` picks the karaoke split; outputs vocals + no_vocals —
 * see pickStems). REPLICATE_SEPARATION_INPUT (a JSON object) merges on top:
 * quality knobs for the same deployment (`{"model_name":"htdemucs_ft",
 * "shifts":2}` is the recommended bump — the DEFAULT htdemucs model is the
 * fast baseline, not the best one), or a whole different input dialect for a
 * different pinned deployment. In overrides, the string "$AUDIO_URL" becomes
 * the presigned audio URL, and a null value deletes a default key.
 */
export function buildSeparationInput(audioUrl: string): Record<string, unknown> {
  const input: Record<string, unknown> = {
    audio: audioUrl,
    two_stems: "vocals",
    output_format: "mp3",
  };
  const raw = process.env.REPLICATE_SEPARATION_INPUT;
  if (raw) {
    try {
      const overrides = JSON.parse(raw) as Record<string, unknown>;
      for (const [key, value] of Object.entries(overrides)) {
        if (value === null) delete input[key];
        else input[key] = value === "$AUDIO_URL" ? audioUrl : value;
      }
    } catch {
      // A malformed override must not take separation down — defaults win.
    }
  }
  return input;
}

export async function startSeparation(audioUrl: string): Promise<SeparationStart> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return { started: false, reason: "REPLICATE_API_TOKEN not configured" };
  }
  // Pin the version via env (the bare hash, not the owner/model: prefix) so a
  // model update never changes output shape underneath us.
  const version = process.env.REPLICATE_DEMUCS_VERSION;
  if (!version) {
    return {
      started: false,
      reason: "REPLICATE_DEMUCS_VERSION not configured (pin a demucs version id)",
    };
  }
  const res = await fetch(`${replicateBase()}/v1/predictions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ version, input: buildSeparationInput(audioUrl) }),
  });
  if (!res.ok) {
    return { started: false, reason: `replicate error ${res.status}: ${await res.text()}` };
  }
  const prediction = (await res.json()) as { urls: { get: string } };
  return { started: true, job: { provider: "replicate", predictionUrl: prediction.urls.get } };
}

export interface PredictionState {
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: string | null;
}

export async function getPrediction(predictionUrl: string): Promise<PredictionState> {
  const res = await fetch(predictionUrl, {
    headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`replicate poll failed: ${res.status}`);
  return (await res.json()) as PredictionState;
}

/**
 * Separation deployments disagree about output shape. Two-stem outputs
 * (no_vocals/instrumental/accompaniment/backing) map to a single backing
 * track. Four-stem outputs (drums/bass/other) map to MULTIPLE backing parts
 * that the player sums — critically, `other` alone must never be mistaken
 * for the instrumental when drums/bass are also present: it's the
 * synths/guitars-only stem, and treating it as the backing is exactly how
 * drums and bass vanish from a karaoke track.
 */
export function pickStems(output: unknown): { vocals?: string; backing: string[] } {
  if (typeof output !== "object" || output === null) return { backing: [] };
  const map = output as Record<string, unknown>;
  const url = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);
  const vocals = url(map.vocals);
  const twoStem =
    url(map.no_vocals) ?? url(map.instrumental) ?? url(map.accompaniment) ?? url(map.backing);
  if (twoStem) return { vocals, backing: [twoStem] };
  const fourStem = [url(map.drums), url(map.bass), url(map.other)].filter(
    (u): u is string => u !== undefined,
  );
  if (fourStem.length >= 2) return { vocals, backing: fourStem };
  // `other` by itself (no drums/bass alongside) genuinely is everything-else.
  const otherOnly = url(map.other);
  return { vocals, backing: otherOnly ? [otherOnly] : [] };
}

// ── word timing (forced alignment) ──────────────────────────────────────────
//
// Two providers, both run over the ISOLATED VOCAL stem (aligning against the
// full mix makes any aligner hallucinate on drums):
//
// - ElevenLabs (preferred when ELEVENLABS_API_KEY is set): true forced
//   alignment — audio + the chosen lyric TEXT in, a timestamp per word of
//   that text out — plus Scribe transcription for the no-sheet path. See
//   lib/elevenlabs.ts.
// - WhisperX on Replicate (fallback): transcribes, we transplant its
//   timestamps onto the chosen text (lib/retime.ts).

export function alignmentProvider(): "elevenlabs" | "replicate" | null {
  if (process.env.ELEVENLABS_API_KEY) return "elevenlabs";
  if (process.env.REPLICATE_API_TOKEN && process.env.REPLICATE_WHISPERX_VERSION) return "replicate";
  return null;
}

export function isAlignmentConfigured(): boolean {
  return alignmentProvider() !== null;
}

export async function startAlignment(vocalsUrl: string): Promise<SeparationStart> {
  const token = process.env.REPLICATE_API_TOKEN;
  const version = process.env.REPLICATE_WHISPERX_VERSION;
  if (!token || !version) {
    return { started: false, reason: "REPLICATE_WHISPERX_VERSION not configured" };
  }
  const res = await fetch(`${replicateBase()}/v1/predictions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      version,
      // whisperx dialect (e.g. victor-upmeet/whisperx): align_output turns on
      // the word-timestamp pass.
      input: { audio_file: vocalsUrl, align_output: true },
    }),
  });
  if (!res.ok) {
    return { started: false, reason: `replicate error ${res.status}: ${await res.text()}` };
  }
  const prediction = (await res.json()) as { urls: { get: string } };
  return { started: true, job: { provider: "replicate", predictionUrl: prediction.urls.get } };
}

interface WhisperWord {
  word?: string;
  text?: string;
  start?: number;
}

interface WhisperSegment {
  start?: number;
  text?: string;
  words?: WhisperWord[];
}

const lrcTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
};

/** Flatten WhisperX output into one heard-word stream for timing transplant. */
export function flattenWhisperWords(output: unknown): { word: string; start: number }[] {
  const segments = (output as { segments?: unknown } | null)?.segments;
  if (!Array.isArray(segments)) return [];
  const out: { word: string; start: number }[] = [];
  for (const seg of segments as WhisperSegment[]) {
    let last = Number.isFinite(seg.start) ? seg.start! : out.at(-1)?.start;
    for (const w of Array.isArray(seg.words) ? seg.words : []) {
      const text = (w.word ?? w.text ?? "").trim();
      if (!text) continue;
      const t = Number.isFinite(w.start) ? w.start! : last;
      if (t === undefined) continue;
      last = t;
      out.push({ word: text, start: t });
    }
  }
  return out;
}

/**
 * WhisperX output → enhanced LRC: one line per segment, `<mm:ss.xx>` tags per
 * word. Words occasionally arrive without a timestamp (numbers, punctuation
 * merges) — they inherit the previous word's time. Returns null when the
 * output shape is unrecognized.
 */
export function whisperxToLrc(output: unknown): string | null {
  const segments = (output as { segments?: unknown } | null)?.segments;
  if (!Array.isArray(segments)) return null;
  const lines: string[] = [];
  for (const raw of segments as WhisperSegment[]) {
    const words = Array.isArray(raw.words) ? raw.words : [];
    const firstTimed = words.find((w) => Number.isFinite(w.start));
    const start = Number.isFinite(raw.start) ? raw.start! : firstTimed?.start;
    if (start === undefined) continue;
    let body: string;
    if (words.length > 0) {
      let last = start;
      const parts: string[] = [];
      for (const w of words) {
        const text = (w.word ?? w.text ?? "").trim();
        if (!text) continue;
        const t = Number.isFinite(w.start) ? w.start! : last;
        last = t;
        parts.push(`<${lrcTime(t)}>${text}`);
      }
      body = parts.join(" ");
    } else {
      body = (raw.text ?? "").trim();
    }
    if (body) lines.push(`[${lrcTime(start)}]${body}`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}
