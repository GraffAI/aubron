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

export interface LyricsResult {
  synced: string | null; // LRC text with timestamps
  plain: string | null;
  source: string;
}

export async function findLyrics(
  artist: string,
  title: string,
  durationSeconds?: number,
): Promise<LyricsResult | null> {
  const headers = { "User-Agent": "aubron-karaoke (https://github.com/GraffAI/aubron)" };
  const get = new URL("https://lrclib.net/api/get");
  get.searchParams.set("artist_name", artist);
  get.searchParams.set("track_name", title);
  if (durationSeconds) get.searchParams.set("duration", String(Math.round(durationSeconds)));
  const exact = await fetch(get, { headers });
  if (exact.ok) {
    const hit = (await exact.json()) as { syncedLyrics: string | null; plainLyrics: string | null };
    return { synced: hit.syncedLyrics, plain: hit.plainLyrics, source: "lrclib:get" };
  }
  // Fuzzy fallback: search and prefer a synced result.
  const search = new URL("https://lrclib.net/api/search");
  search.searchParams.set("artist_name", artist);
  search.searchParams.set("track_name", title);
  const res = await fetch(search, { headers });
  if (!res.ok) return null;
  const hits = (await res.json()) as { syncedLyrics: string | null; plainLyrics: string | null }[];
  const best = hits.find((h) => h.syncedLyrics) ?? hits[0];
  if (!best) return null;
  return { synced: best.syncedLyrics, plain: best.plainLyrics, source: "lrclib:search" };
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

export async function startSeparation(audioUrl: string): Promise<SeparationStart> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return { started: false, reason: "REPLICATE_API_TOKEN not configured" };
  }
  // htdemucs two-stem mode: vocals + everything else. Pin the version via env
  // (the bare hash, not the owner/model: prefix) so a model update never
  // changes output shape underneath us.
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
    body: JSON.stringify({
      version,
      // ryan5453/demucs dialect: `two_stems` picks the karaoke split
      // (output keys: vocals + no_vocals — see pickStems).
      input: { audio: audioUrl, two_stems: "vocals", output_format: "mp3" },
    }),
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
 * Demucs deployments name their two-stem outputs inconsistently; accept the
 * common spellings. Returns undefineds when the shape is unrecognized.
 */
export function pickStems(output: unknown): { vocals?: string; instrumental?: string } {
  if (typeof output !== "object" || output === null) return {};
  const map = output as Record<string, unknown>;
  const url = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : undefined);
  return {
    vocals: url(map.vocals),
    instrumental:
      url(map.no_vocals) ??
      url(map.instrumental) ??
      url(map.accompaniment) ??
      url(map.backing) ??
      url(map.other),
  };
}

export interface AlignmentResult {
  available: false;
  reason: string;
}

export function alignLyrics(): AlignmentResult {
  return {
    available: false,
    reason:
      "Forced alignment not configured. Recommended: WhisperX (word-level timestamps via " +
      "wav2vec2 alignment) run over the separated VOCAL stem, seeded with the plain lyrics.",
  };
}
