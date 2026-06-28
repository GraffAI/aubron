/**
 * Thin ElevenLabs text-to-speech client — just the two calls the goal announcer
 * needs: resolve a voice by name, and synthesize a line of MP3.
 *
 * Output is requested as `mp3_44100_128` so it concatenates cleanly with the
 * goal horn (see mp3.ts). The default voice is the stock "British Football
 * Announcer"; the default model is Eleven v3.
 */
const API = "https://api.elevenlabs.io";

export interface SynthOptions {
  apiKey: string;
  /** A voice id, or a name to resolve via the account's voice list. */
  voice: string;
  model: string;
  text: string;
  timeoutMs?: number;
}

/** A 20-char ElevenLabs voice id, vs a human name we need to look up. */
function looksLikeVoiceId(s: string): boolean {
  return /^[A-Za-z0-9]{20}$/.test(s);
}

/** Resolve a voice name (e.g. "British Football Announcer") to its id. */
export async function resolveVoiceId(
  apiKey: string,
  nameOrId: string,
  timeoutMs = 10_000,
): Promise<string> {
  if (looksLikeVoiceId(nameOrId)) return nameOrId;
  const res = await fetch(`${API}/v2/voices?search=${encodeURIComponent(nameOrId)}&page_size=10`, {
    headers: { "xi-api-key": apiKey },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`voices ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { voices?: Array<{ voice_id: string; name: string }> };
  const want = nameOrId.toLowerCase();
  const hit = body.voices?.find((v) => v.name.toLowerCase() === want) ?? body.voices?.[0];
  if (!hit) throw new Error(`no voice matching "${nameOrId}"`);
  return hit.voice_id;
}

/** Synthesize `text` to an MP3 buffer (44.1 kHz / 128 kbps). */
export async function synthesize(opts: SynthOptions): Promise<Buffer> {
  const voiceId = await resolveVoiceId(opts.apiKey, opts.voice, opts.timeoutMs);
  const res = await fetch(`${API}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: {
      "xi-api-key": opts.apiKey,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({ text: opts.text, model_id: opts.model }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  if (!res.ok) {
    throw new Error(`tts ${res.status} ${res.statusText}: ${await res.text().catch(() => "")}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
