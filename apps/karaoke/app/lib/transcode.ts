/**
 * In-browser transcoding — the answer to the first thing real users tried:
 * uploading a 600 MB 6-channel FLAC. Anything lossless/uncompressed or wider
 * than stereo is downmixed with an OfflineAudioContext and encoded to MP3 by
 * a WebAssembly LAME build *before* it touches the network, so the bucket,
 * the separation provider, and the tab-local session all see a small stereo
 * file. Already-compressed stereo uploads (MP3/AAC/OGG/Opus) pass through
 * untouched — a decode→re-encode round trip would only cost quality.
 */

/** What acceptFile learned about the dropped file (decode already succeeded). */
export interface AudioProbe {
  fileName: string;
  contentType: string;
  bytes: number;
  channels: number;
  sampleRate: number;
}

export interface TranscodePlan {
  action: "keep" | "transcode";
  /** Why it's being converted, human-readable (e.g. "6-channel FLAC"). */
  reason: string;
  targetChannels: 1 | 2;
  /** An MP3-legal rate; sources above 48 kHz get resampled down. */
  targetSampleRate: number;
}

/** Formats whose bytes are worth shipping as-is (compressed, web-native). */
const COMPRESSED_EXTS = new Set(["mp3", "m4a", "aac", "mp4", "ogg", "opus", "webm"]);
const COMPRESSED_MIMES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/opus",
  "audio/webm",
]);

const MP3_SAMPLE_RATES = new Set([8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]);

export function fileExt(fileName: string): string {
  return /\.([a-z0-9]{1,5})$/i.exec(fileName)?.[1]?.toLowerCase() ?? "";
}

/** `song.flac` → `song.mp3` (extension appended when there was none). */
export function mp3FileName(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]{1,5}$/i, "");
  return `${base || "song"}.mp3`;
}

/**
 * Decide whether a decoded upload should be converted before use. Two
 * triggers, both cheap to detect once the browser has decoded the file:
 *
 * - the container is lossless/uncompressed (FLAC/WAV/AIFF/unknown) — huge on
 *   the wire for zero audible benefit downstream;
 * - more than two channels — surround mixes waste bandwidth and separation
 *   models expect mono/stereo anyway.
 */
export function transcodePlan(probe: AudioProbe): TranscodePlan {
  const ext = fileExt(probe.fileName);
  const compressed =
    COMPRESSED_EXTS.has(ext) || COMPRESSED_MIMES.has(probe.contentType.toLowerCase());
  const surround = probe.channels > 2;

  const targetChannels: 1 | 2 = probe.channels === 1 ? 1 : 2;
  const targetSampleRate = MP3_SAMPLE_RATES.has(probe.sampleRate)
    ? probe.sampleRate
    : probe.sampleRate > 48000
      ? 48000
      : 44100;

  if (compressed && !surround) {
    return { action: "keep", reason: "", targetChannels, targetSampleRate };
  }
  const format = ext ? ext.toUpperCase() : "audio";
  const reason = surround ? `${probe.channels}-channel ${format}` : format;
  return { action: "transcode", reason, targetChannels, targetSampleRate };
}

/**
 * Downmix/resample via OfflineAudioContext. The Web Audio "speakers" rules
 * give a proper stereo fold-down for mono/quad/5.1 sources; exotic layouts
 * fall back to the spec's discrete mapping, which at worst drops the extra
 * channels — still a playable stereo file.
 */
async function renderForEncode(decoded: AudioBuffer, plan: TranscodePlan): Promise<AudioBuffer> {
  if (
    decoded.numberOfChannels === plan.targetChannels &&
    decoded.sampleRate === plan.targetSampleRate
  ) {
    return decoded;
  }
  const length = Math.max(1, Math.ceil(decoded.duration * plan.targetSampleRate));
  const ctx = new OfflineAudioContext(plan.targetChannels, length, plan.targetSampleRate);
  const source = ctx.createBufferSource();
  source.buffer = decoded;
  source.connect(ctx.destination);
  source.start();
  return ctx.startRendering();
}

// ~3 s of 44.1 kHz audio per encode call: big enough to keep the wasm call
// overhead negligible, small enough that progress ticks and the UI breathes.
const ENCODE_CHUNK = 131072;

/**
 * Encode an already-decoded AudioBuffer to MP3 (LAME VBR ~190 kbps) entirely
 * in the browser. Chunked, with an event-loop yield per chunk so the progress
 * callback actually paints. Returns a fresh ArrayBuffer ready for upload.
 */
export async function transcodeToMp3(
  decoded: AudioBuffer,
  plan: TranscodePlan,
  onProgress?: (fraction: number) => void,
): Promise<ArrayBuffer> {
  const rendered = await renderForEncode(decoded, plan);
  // Dynamic import: the encoder inlines its wasm (~175 KB) — only fetched
  // when a conversion actually runs, not on every page load.
  const { createMp3Encoder } = await import("wasm-media-encoders");
  const encoder = await createMp3Encoder();
  encoder.configure({
    channels: plan.targetChannels,
    sampleRate: rendered.sampleRate,
    vbrQuality: 2,
  });
  const channels = Array.from({ length: plan.targetChannels }, (_, i) =>
    rendered.getChannelData(Math.min(i, rendered.numberOfChannels - 1)),
  );
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < rendered.length; offset += ENCODE_CHUNK) {
    const end = Math.min(offset + ENCODE_CHUNK, rendered.length);
    // encode() returns a view into wasm memory — copy before the next call.
    parts.push(encoder.encode(channels.map((ch) => ch.subarray(offset, end))).slice());
    onProgress?.(end / rendered.length);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  parts.push(encoder.finalize().slice());

  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out.buffer;
}
