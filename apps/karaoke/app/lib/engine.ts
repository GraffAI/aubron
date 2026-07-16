/**
 * KaraokeEngine — one Web Audio graph for the whole show:
 *
 *   voice leg ───► vocalsLeg ─┐
 *   backing leg ─► instLeg  ──┼─► trackGain ─► master ─► speakers
 *   mic 1 ───► gain ─► dry+echo ─────────────► master
 *   mic N ───► gain ─► dry+echo ─────────────► master
 *
 * Two track modes:
 * - "stems": voice leg = separated vocals, backing leg = instrumental; the
 *   two faders are independent gains (the demo song works this way).
 * - "crossfade": voice leg = the UNTOUCHED full mix, backing leg = the
 *   separated instrumental. The vocal fader v drives a complementary linear
 *   crossfade (full×v + instrumental×(1−v)) — linear, not equal-power,
 *   because the signals are correlated. At v=1 you hear the original song
 *   bit-exact, so separation residue can never lose content; at v=0 it's
 *   pure instrumental. The backing fader becomes overall track volume.
 *
 * Multiple simultaneous microphones ARE supported on the web: each mic is its
 * own getUserMedia() stream keyed by deviceId, so duet mode is just two
 * channels on the rack. Echo cancellation / AGC / noise suppression are
 * disabled per-mic — they're built for speech calls and mangle singing.
 */

import { estimateBufferLag } from "./align-lag";

export type StemGains = { vocals: number; instrumental: number };

/** Snapshot of what the engine decoded and wired up, for diagnostics. */
export interface LoadedInfo {
  crossfade: boolean;
  vocals: boolean;
  /** Instrumental + extras — 4-stem separations should show 3 here. */
  backingParts: number;
  /** Codec-delay compensation applied to the backing leg. */
  lagMs: number;
}

export interface MicChannel {
  id: number;
  deviceId: string;
  label: string;
  gain: number;
  echo: number;
}

interface MicNodes {
  channel: MicChannel;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  echoSend: GainNode;
  analyser: AnalyserNode;
  levelBuf: Float32Array<ArrayBuffer>;
}

export class KaraokeEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private vocalsLeg: GainNode;
  private instLeg: GainNode;
  private trackGain: GainNode;
  private buffers: {
    vocals: AudioBuffer | null;
    instrumental: AudioBuffer;
    extras: AudioBuffer[];
    full: AudioBuffer | null;
  } | null = null;
  private vocalsValue = 0.25; // karaoke: guide vocals ducked by default
  private backingValue = 1;
  private sources: AudioBufferSourceNode[] = [];
  private playGeneration = 0;
  private startedAt = 0; // ctx.currentTime when playback began
  private offset = 0; // song position when paused / at play start
  /** Seconds the backing stem runs late vs the full mix (codec delay). */
  private instLagSeconds = 0;
  private _playing = false;
  private mics = new Map<number, MicNodes>();
  private nextMicId = 1;
  duration = 0;
  onended: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.master = new GainNode(this.ctx, { gain: 1 });
    this.master.connect(this.ctx.destination);
    this.trackGain = new GainNode(this.ctx, { gain: 1 });
    this.trackGain.connect(this.master);
    this.vocalsLeg = new GainNode(this.ctx, { gain: this.vocalsValue });
    this.instLeg = new GainNode(this.ctx, { gain: 1 });
    this.vocalsLeg.connect(this.trackGain);
    this.instLeg.connect(this.trackGain);
  }

  /** True when the vocal fader is a full-mix ↔ instrumental crossfade. */
  get crossfade(): boolean {
    return this.buffers?.full != null;
  }

  /** What actually made it into the audio graph — the ⓘ panel shows this so
   *  "stored in the bucket" and "playing through the speakers" can disagree
   *  visibly (e.g. a stale manifest served fewer backing parts). */
  get loadedInfo(): LoadedInfo | null {
    if (!this.buffers) return null;
    return {
      crossfade: this.buffers.full != null,
      vocals: this.buffers.vocals != null,
      backingParts: 1 + this.buffers.extras.length,
      lagMs: Math.round(this.instLagSeconds * 1000),
    };
  }

  // ── stems ────────────────────────────────────────────────────────────────

  loadBuffers(
    vocals: AudioBuffer | null,
    instrumental: AudioBuffer,
    full: AudioBuffer | null = null,
    extras: AudioBuffer[] = [],
  ): void {
    this.stop();
    this.buffers = { vocals, instrumental, extras, full };
    this.duration = instrumental.duration;
    this.offset = 0;
    // The separated backing is a re-encoded MP3 and codecs add decoder delay,
    // so it runs tens of ms late vs the untouched full mix. The crossfade
    // SUMS the two — misaligned, that's a comb filter that guts kick/bass.
    // Measure the lag once and compensate at source start.
    this.instLagSeconds = 0;
    if (full) {
      this.instLagSeconds = estimateBufferLag(full, instrumental) ?? 0;
    }
    this.applyTrackGains(true);
  }

  async loadFromUrls(urls: {
    vocals?: string;
    instrumental: string;
    extras?: string[];
    full?: string;
  }): Promise<void> {
    const fetchStem = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`stem fetch failed: ${url} (${res.status})`);
      return this.ctx.decodeAudioData(await res.arrayBuffer());
    };
    // With a full mix available the vocal stem isn't played — don't fetch it.
    const [instrumental, full, vocals, extras] = await Promise.all([
      fetchStem(urls.instrumental),
      urls.full ? fetchStem(urls.full) : Promise.resolve(null),
      !urls.full && urls.vocals ? fetchStem(urls.vocals) : Promise.resolve(null),
      Promise.all((urls.extras ?? []).map(fetchStem)),
    ]);
    this.loadBuffers(vocals, instrumental, full, extras);
  }

  /** A local file has no separated stems: the full mix rides the instrumental fader. */
  async loadLocalMix(data: ArrayBuffer): Promise<void> {
    // decodeAudioData detaches its input — decode a copy so the session-local
    // bytes survive a replay (and StrictMode's double effect-mount in dev).
    this.loadBuffers(null, await this.ctx.decodeAudioData(data.slice(0)));
  }

  // ── transport ────────────────────────────────────────────────────────────

  get playing(): boolean {
    return this._playing;
  }

  get time(): number {
    const t = this._playing ? this.offset + this.ctx.currentTime - this.startedAt : this.offset;
    return Math.min(t, this.duration);
  }

  async play(): Promise<void> {
    if (!this.buffers || this._playing) return;
    await this.ctx.resume();
    if (this.offset >= this.duration) this.offset = 0;
    const generation = ++this.playGeneration;
    this.sources = [];
    // Alignment compensation: skip the codec-delay head of whichever signal
    // runs late, so full and backing sum in phase at every fader position.
    const fullSkip = Math.max(0, -this.instLagSeconds);
    const instSkip = Math.max(0, this.instLagSeconds);
    const start = (buffer: AudioBuffer, dest: GainNode, watchEnd: boolean, skip = 0) => {
      const src = new AudioBufferSourceNode(this.ctx, { buffer });
      src.connect(dest);
      src.start(0, Math.min(this.offset + skip, buffer.duration));
      if (watchEnd) {
        src.onended = () => {
          // Only a natural end of the *current* playback run counts.
          if (generation !== this.playGeneration || !this._playing) return;
          this._playing = false;
          this.offset = this.duration;
          this.onended?.();
        };
      }
      this.sources.push(src);
    };
    if (this.buffers.full) start(this.buffers.full, this.vocalsLeg, false, fullSkip);
    else if (this.buffers.vocals) start(this.buffers.vocals, this.vocalsLeg, false);
    start(this.buffers.instrumental, this.instLeg, true, instSkip);
    // 4-stem providers: bass/other parts sum into the same backing leg —
    // together with the first part they reconstruct the full instrumental.
    for (const extra of this.buffers.extras) start(extra, this.instLeg, false, instSkip);
    this.startedAt = this.ctx.currentTime;
    this._playing = true;
  }

  pause(): void {
    if (!this._playing) return;
    this.offset = this.time;
    this.stop();
  }

  private stop(): void {
    this.playGeneration++;
    for (const src of this.sources) {
      try {
        src.stop();
      } catch {
        /* never started or already stopped */
      }
    }
    this.sources = [];
    this._playing = false;
  }

  async seek(t: number): Promise<void> {
    const wasPlaying = this._playing;
    this.stop();
    this.offset = Math.max(0, Math.min(t, this.duration));
    if (wasPlaying) await this.play();
  }

  setStemGain(stem: keyof StemGains, value: number): void {
    if (stem === "vocals") this.vocalsValue = value;
    else this.backingValue = value;
    this.applyTrackGains(false);
  }

  /** Route the two fader values into the graph for the current mode. */
  private applyTrackGains(immediate: boolean): void {
    const set = (node: GainNode, value: number) => {
      if (immediate) node.gain.value = value;
      else node.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
    };
    if (this.crossfade) {
      // full×v + instrumental×(1−v), both under the track volume.
      set(this.vocalsLeg, this.vocalsValue);
      set(this.instLeg, 1 - this.vocalsValue);
      set(this.trackGain, this.backingValue);
    } else {
      set(this.vocalsLeg, this.vocalsValue);
      set(this.instLeg, this.backingValue);
      set(this.trackGain, 1);
    }
  }

  setMasterGain(value: number): void {
    this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
  }

  // ── microphones ──────────────────────────────────────────────────────────

  async listMicDevices(): Promise<MediaDeviceInfo[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === "audioinput");
  }

  /** Open a mic (any number may be open at once — that's duet mode). */
  async addMic(deviceId?: string): Promise<MicChannel> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
      },
    });
    const track = stream.getAudioTracks()[0];
    const source = new MediaStreamAudioSourceNode(this.ctx, { mediaStream: stream });
    const gain = new GainNode(this.ctx, { gain: 0.9 });
    const analyser = new AnalyserNode(this.ctx, { fftSize: 512 });

    // Feedback-delay "stage echo", the timeless karaoke vice.
    const echoSend = new GainNode(this.ctx, { gain: 0 });
    const delay = new DelayNode(this.ctx, { delayTime: 0.26, maxDelayTime: 1 });
    const feedback = new GainNode(this.ctx, { gain: 0.4 });
    echoSend.connect(delay).connect(feedback).connect(delay);
    delay.connect(this.master);

    source.connect(gain);
    gain.connect(analyser);
    gain.connect(this.master);
    gain.connect(echoSend);

    const channel: MicChannel = {
      id: this.nextMicId++,
      deviceId: track?.getSettings().deviceId ?? deviceId ?? "",
      label: track?.label || `Mic ${this.nextMicId - 1}`,
      gain: 0.9,
      echo: 0,
    };
    this.mics.set(channel.id, {
      channel,
      stream,
      source,
      gain,
      echoSend,
      analyser,
      levelBuf: new Float32Array(analyser.fftSize),
    });
    await this.ctx.resume();
    return channel;
  }

  removeMic(id: number): void {
    const mic = this.mics.get(id);
    if (!mic) return;
    for (const track of mic.stream.getTracks()) track.stop();
    mic.source.disconnect();
    mic.gain.disconnect();
    mic.echoSend.disconnect();
    this.mics.delete(id);
  }

  listMics(): MicChannel[] {
    return [...this.mics.values()].map((m) => m.channel);
  }

  setMicGain(id: number, value: number): void {
    const mic = this.mics.get(id);
    if (!mic) return;
    mic.channel.gain = value;
    mic.gain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
  }

  setMicEcho(id: number, value: number): void {
    const mic = this.mics.get(id);
    if (!mic) return;
    mic.channel.echo = value;
    mic.echoSend.gain.setTargetAtTime(value * 0.6, this.ctx.currentTime, 0.02);
  }

  /** RMS level 0..1 for the mic's meter; poll from requestAnimationFrame. */
  micLevel(id: number): number {
    const mic = this.mics.get(id);
    if (!mic) return 0;
    mic.analyser.getFloatTimeDomainData(mic.levelBuf);
    let sum = 0;
    for (const sample of mic.levelBuf) sum += sample * sample;
    return Math.min(1, Math.sqrt(sum / mic.levelBuf.length) * 3);
  }

  dispose(): void {
    this.stop();
    for (const id of [...this.mics.keys()]) this.removeMic(id);
    void this.ctx.close();
  }
}
