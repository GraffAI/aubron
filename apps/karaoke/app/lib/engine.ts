/**
 * KaraokeEngine — one Web Audio graph for the whole show:
 *
 *   vocals stem ──► vocalsGain ─┐
 *   instrumental ► instrGain  ─┼─► master ─► analyser ─► speakers
 *   mic 1 ───► gain ─► dry+echo ┤
 *   mic N ───► gain ─► dry+echo ┘
 *
 * Multiple simultaneous microphones ARE supported on the web: each mic is its
 * own getUserMedia() stream keyed by deviceId, so duet mode is just two
 * channels on the rack. Echo cancellation / AGC / noise suppression are
 * disabled per-mic — they're built for speech calls and mangle singing.
 */

export type StemGains = { vocals: number; instrumental: number };

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
  private stemGains: Record<keyof StemGains, GainNode>;
  private buffers: { vocals: AudioBuffer | null; instrumental: AudioBuffer } | null = null;
  private sources: AudioBufferSourceNode[] = [];
  private playGeneration = 0;
  private startedAt = 0; // ctx.currentTime when playback began
  private offset = 0; // song position when paused / at play start
  private _playing = false;
  private mics = new Map<number, MicNodes>();
  private nextMicId = 1;
  duration = 0;
  onended: (() => void) | null = null;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.master = new GainNode(this.ctx, { gain: 1 });
    this.master.connect(this.ctx.destination);
    this.stemGains = {
      vocals: new GainNode(this.ctx, { gain: 0.25 }), // karaoke: vocals ducked by default
      instrumental: new GainNode(this.ctx, { gain: 1 }),
    };
    this.stemGains.vocals.connect(this.master);
    this.stemGains.instrumental.connect(this.master);
  }

  // ── stems ────────────────────────────────────────────────────────────────

  loadBuffers(vocals: AudioBuffer | null, instrumental: AudioBuffer): void {
    this.stop();
    this.buffers = { vocals, instrumental };
    this.duration = instrumental.duration;
    this.offset = 0;
  }

  async loadFromUrls(urls: { vocals: string; instrumental: string }): Promise<void> {
    const fetchStem = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`stem fetch failed: ${url} (${res.status})`);
      return this.ctx.decodeAudioData(await res.arrayBuffer());
    };
    const [vocals, instrumental] = await Promise.all([
      fetchStem(urls.vocals),
      fetchStem(urls.instrumental),
    ]);
    this.loadBuffers(vocals, instrumental);
  }

  /** A local file has no separated stems: the full mix rides the instrumental fader. */
  async loadLocalMix(data: ArrayBuffer): Promise<void> {
    this.loadBuffers(null, await this.ctx.decodeAudioData(data));
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
    const start = (buffer: AudioBuffer, dest: GainNode, watchEnd: boolean) => {
      const src = new AudioBufferSourceNode(this.ctx, { buffer });
      src.connect(dest);
      src.start(0, this.offset);
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
    if (this.buffers.vocals) start(this.buffers.vocals, this.stemGains.vocals, false);
    start(this.buffers.instrumental, this.stemGains.instrumental, true);
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
    this.stemGains[stem].gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
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
