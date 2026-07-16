import type { TimedToken } from "./retime";

/**
 * ElevenLabs client for the two word-timing paths:
 *
 * - Forced alignment (/v1/forced-alignment): audio + the CHOSEN lyric text →
 *   a timestamp for every word of that text. True text-conditioned alignment
 *   — strictly better than transcribe-then-match, because the model never
 *   gets to disagree about the words.
 * - Scribe STT (/v1/speech-to-text): audio → transcript with word-level
 *   timestamps, for the no-sheet path.
 *
 * Both run over the ISOLATED VOCAL STEM: their accuracy caveat is background
 * noise, and separation removes it. Calls are synchronous HTTPS — no polling.
 */

export function isElevenLabsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

const baseUrl = () => process.env.ELEVENLABS_BASE_URL ?? "https://api.elevenlabs.io";

/** Error carrying HTTP status so callers can tell fatal (4xx) from transient. */
export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
  get fatal(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

interface ElevenLabsWord {
  text?: string;
  word?: string;
  start?: number;
  end?: number;
  type?: string; // "word" | "spacing" | "audio_event"
}

function toTokens(words: unknown): TimedToken[] {
  if (!Array.isArray(words)) return [];
  const out: TimedToken[] = [];
  for (const raw of words as ElevenLabsWord[]) {
    const text = (raw.text ?? raw.word ?? "").trim();
    if (!text || raw.type === "spacing" || raw.type === "audio_event") continue;
    if (!Number.isFinite(raw.start)) continue;
    out.push({ word: text, start: raw.start! });
  }
  return out;
}

async function post(path: string, form: FormData): Promise<Record<string, unknown>> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" },
    body: form,
  });
  if (!res.ok) {
    throw new ElevenLabsError(
      `elevenlabs ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`,
      res.status,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

/** Force-align `text` to the audio; returns a timestamp per word of `text`. */
export async function elevenLabsAlign(audio: Uint8Array, text: string): Promise<TimedToken[]> {
  const form = new FormData();
  form.append("file", new Blob([audio as BlobPart], { type: "audio/mpeg" }), "vocals.mp3");
  form.append("text", text);
  const body = await post("/v1/forced-alignment", form);
  return toTokens(body.words);
}

/** Scribe transcription with word-level timestamps (no-sheet fallback). */
export async function elevenLabsTranscribe(audio: Uint8Array): Promise<TimedToken[]> {
  const form = new FormData();
  form.append("file", new Blob([audio as BlobPart], { type: "audio/mpeg" }), "vocals.mp3");
  form.append("model_id", "scribe_v1");
  const body = await post("/v1/speech-to-text", form);
  return toTokens(body.words);
}
