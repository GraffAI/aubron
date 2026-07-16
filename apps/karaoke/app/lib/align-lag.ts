/**
 * Stem alignment: the backing stem comes back from the separation provider as
 * a re-encoded MP3, and MP3 codecs add decoder delay — so it plays tens of
 * milliseconds late relative to the untouched original. The player's
 * crossfade sums the two, and summing near-identical signals offset by ~30ms
 * is a comb filter: kick drums, bass, and low synths cancel. Estimating the
 * lag once (normalized cross-correlation on decimated mono) and compensating
 * at source start restores the low end at every fader position.
 */

/** Mono, decimated view of an AudioBuffer segment (pure math — testable). */
export function decimateMono(
  channels: Float32Array[],
  fromSample: number,
  sampleCount: number,
  factor: number,
): Float32Array {
  const out = new Float32Array(Math.floor(sampleCount / factor));
  for (let i = 0; i < out.length; i++) {
    let sum = 0;
    const base = fromSample + i * factor;
    for (const ch of channels) {
      // Average the decimation block per channel to tame aliasing a bit.
      let acc = 0;
      for (let k = 0; k < factor; k++) acc += ch[base + k] ?? 0;
      sum += acc / factor;
    }
    out[i] = sum / channels.length;
  }
  return out;
}

/**
 * Seconds by which `b` lags `a` (positive = b is late). Null when the
 * normalized correlation peak is too weak to trust — unrelated signals must
 * not cause a bogus shift.
 */
export function estimateLag(
  a: Float32Array,
  b: Float32Array,
  sampleRate: number,
  maxLagSeconds = 0.25,
  minCorrelation = 0.5,
): number | null {
  const n = Math.min(a.length, b.length);
  const maxLag = Math.min(Math.floor(maxLagSeconds * sampleRate), Math.floor(n / 2));
  if (n < sampleRate || maxLag <= 0) return null;

  // Precompute energies for normalization.
  let ea = 0;
  let eb = 0;
  for (let i = 0; i < n; i++) {
    ea += a[i]! * a[i]!;
    eb += b[i]! * b[i]!;
  }
  if (ea === 0 || eb === 0) return null;
  const denom = Math.sqrt(ea * eb);

  let bestLag = 0;
  let bestCorr = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let dot = 0;
    const from = Math.max(0, -lag);
    const to = Math.min(n, n - lag);
    for (let i = from; i < to; i++) dot += a[i]! * b[i + lag]!;
    if (dot > bestCorr) {
      bestCorr = dot;
      bestLag = lag;
    }
  }
  if (bestCorr / denom < minCorrelation) return null;
  return bestLag / sampleRate;
}

/**
 * Estimate how late `b` (the separated backing) runs vs `a` (the original
 * full mix), using a mid-song window where both are usually busy.
 */
export function estimateBufferLag(a: AudioBuffer, b: AudioBuffer): number | null {
  const rate = a.sampleRate;
  if (b.sampleRate !== rate) return null; // decodeAudioData normalizes; bail if not
  const factor = Math.max(1, Math.round(rate / 5512));
  const start = Math.floor(Math.min(5, a.duration / 4) * rate);
  const window = Math.floor(Math.min(10, a.duration / 2) * rate);
  if (window < rate) return null;
  const channelsOf = (buf: AudioBuffer) =>
    Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const da = decimateMono(channelsOf(a), start, window, factor);
  const db = decimateMono(channelsOf(b), start, window, factor);
  return estimateLag(da, db, rate / factor);
}
