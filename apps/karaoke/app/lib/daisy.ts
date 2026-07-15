import type { LyricLine, Song, TimedWord } from "./types";

/**
 * The built-in demo song: the chorus of "Daisy Bell" (Harry Dacre, 1892 —
 * public domain). Both stems are synthesized client-side with an
 * OfflineAudioContext, and the word-timed lyrics are derived from the same
 * note schedule, so the app ships fully playable with zero audio assets and
 * zero copyright exposure.
 */

const BPM = 138;
const SPB = 60 / BPM; // seconds per beat, 3/4 waltz
const INTRO_BEATS = 6; // two bars of oom-pah before the melody
const TAIL_SECONDS = 1.6; // let the last chord ring

const beatToTime = (beat: number) => beat * SPB;

/** Melody note: start beat, length in beats, MIDI pitch, and the display word
 *  it begins (multi-note words leave `word` unset on continuation notes). */
interface MelodyNote {
  beat: number;
  len: number;
  midi: number;
  word?: string;
}

interface Phrase {
  text: string;
  notes: MelodyNote[];
}

// Beats are relative to the melody start (intro offset applied later).
const PHRASES: Phrase[] = [
  {
    text: "Daisy, Daisy, give me your answer do",
    notes: [
      { beat: 0, len: 3, midi: 74, word: "Daisy," },
      { beat: 3, len: 3, midi: 71 },
      { beat: 6, len: 3, midi: 67, word: "Daisy," },
      { beat: 9, len: 3, midi: 62 },
      { beat: 12, len: 1, midi: 64, word: "give" },
      { beat: 13, len: 1, midi: 66, word: "me" },
      { beat: 14, len: 1, midi: 67, word: "your" },
      { beat: 15, len: 2, midi: 64, word: "answer" },
      { beat: 17, len: 1, midi: 61 },
      { beat: 18, len: 6, midi: 62, word: "do" },
    ],
  },
  {
    text: "I'm half crazy, all for the love of you",
    notes: [
      { beat: 24, len: 3, midi: 69, word: "I'm" },
      { beat: 27, len: 3, midi: 74, word: "half" },
      { beat: 30, len: 3, midi: 71, word: "crazy," },
      { beat: 33, len: 3, midi: 67 },
      { beat: 36, len: 1, midi: 69, word: "all" },
      { beat: 37, len: 1, midi: 67, word: "for" },
      { beat: 38, len: 1, midi: 66, word: "the" },
      { beat: 39, len: 2, midi: 67, word: "love" },
      { beat: 41, len: 1, midi: 64, word: "of" },
      { beat: 42, len: 6, midi: 62, word: "you" },
    ],
  },
];

/** Per-bar harmony for oom-pah accompaniment: bass MIDI + chord MIDI notes. */
interface Bar {
  bass: number;
  chord: number[];
}
const D: Bar = { bass: 38, chord: [57, 62, 66] };
const G: Bar = { bass: 43, chord: [55, 59, 62] };
const A7: Bar = { bass: 45, chord: [55, 61, 64] };
// 2 intro bars, 16 melody bars, 2 outro bars.
const BARS: Bar[] = [D, A7, D, G, G, D, D, A7, D, D, D, D, G, G, D, A7, D, D, D, D];

const midiToFreq = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

export const DAISY_DURATION = beatToTime(INTRO_BEATS + 48 + 6) + TAIL_SECONDS;

function buildLyrics(): LyricLine[] {
  return PHRASES.map((phrase) => {
    const words: TimedWord[] = [];
    for (const note of phrase.notes) {
      if (note.word) words.push({ time: beatToTime(note.beat + INTRO_BEATS), text: note.word });
    }
    return { time: words[0]?.time ?? 0, text: phrase.text, words };
  });
}

export const daisySong: Song = {
  id: "daisy-bell",
  title: "Daisy Bell (Bicycle Built for Two)",
  artist: "Harry Dacre — 1892, public domain",
  duration: DAISY_DURATION,
  source: { kind: "builtin", id: "daisy-bell" },
  lyrics: buildLyrics(),
  wordTimed: true,
};

interface Voice {
  type: OscillatorType;
  gain: number;
  attack: number;
  release: number;
  cutoff: number;
  vibrato?: boolean;
  detune?: number;
}

function playNote(
  ctx: OfflineAudioContext,
  dest: AudioNode,
  freq: number,
  start: number,
  dur: number,
  voice: Voice,
): void {
  const oscillators = [new OscillatorNode(ctx, { type: voice.type, frequency: freq })];
  if (voice.detune) {
    oscillators.push(
      new OscillatorNode(ctx, { type: voice.type, frequency: freq, detune: voice.detune }),
    );
  }
  if (voice.vibrato) {
    const lfo = new OscillatorNode(ctx, { frequency: 5.5 });
    const depth = new GainNode(ctx, { gain: freq * 0.006 });
    lfo.connect(depth);
    for (const osc of oscillators) depth.connect(osc.frequency);
    lfo.start(start + 0.15);
    lfo.stop(start + dur + voice.release);
  }
  const filter = new BiquadFilterNode(ctx, { type: "lowpass", frequency: voice.cutoff, Q: 0.7 });
  const env = new GainNode(ctx, { gain: 0 });
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(voice.gain / oscillators.length, start + voice.attack);
  env.gain.setValueAtTime(
    voice.gain / oscillators.length,
    start + Math.max(voice.attack, dur - voice.release),
  );
  env.gain.linearRampToValueAtTime(0, start + dur);
  for (const osc of oscillators) {
    osc.connect(filter);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }
  filter.connect(env).connect(dest);
}

function renderVocals(ctx: OfflineAudioContext): void {
  const out = new GainNode(ctx, { gain: 0.9 });
  out.connect(ctx.destination);
  const voice: Voice = {
    type: "triangle",
    gain: 0.42,
    attack: 0.05,
    release: 0.09,
    cutoff: 2400,
    vibrato: true,
    detune: 7,
  };
  for (const phrase of PHRASES) {
    for (const note of phrase.notes) {
      const start = beatToTime(note.beat + INTRO_BEATS);
      playNote(ctx, out, midiToFreq(note.midi), start, beatToTime(note.len) * 0.96, voice);
    }
  }
}

function renderInstrumental(ctx: OfflineAudioContext): void {
  const out = new GainNode(ctx, { gain: 0.9 });
  out.connect(ctx.destination);
  const bassVoice: Voice = { type: "sine", gain: 0.5, attack: 0.01, release: 0.12, cutoff: 400 };
  const chordVoice: Voice = {
    type: "triangle",
    gain: 0.16,
    attack: 0.015,
    release: 0.1,
    cutoff: 1600,
  };

  // Percussive tick: a short burst of filtered noise on every beat.
  const tickLength = Math.floor(ctx.sampleRate * 0.03);
  const noise = new AudioBuffer({ length: tickLength, sampleRate: ctx.sampleRate });
  const data = noise.getChannelData(0);
  for (let i = 0; i < tickLength; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / tickLength);

  BARS.forEach((bar, barIndex) => {
    const barStart = beatToTime(barIndex * 3);
    // Oom: bass on beat 1.
    playNote(ctx, out, midiToFreq(bar.bass), barStart, SPB * 0.95, bassVoice);
    // Pah-pah: chord stabs on beats 2 and 3.
    for (const beat of [1, 2]) {
      for (const midi of bar.chord) {
        playNote(ctx, out, midiToFreq(midi), barStart + beatToTime(beat), SPB * 0.55, chordVoice);
      }
    }
    for (let beat = 0; beat < 3; beat++) {
      const tick = new AudioBufferSourceNode(ctx, { buffer: noise });
      const tickFilter = new BiquadFilterNode(ctx, { type: "highpass", frequency: 6000 });
      const tickGain = new GainNode(ctx, { gain: beat === 0 ? 0.1 : 0.05 });
      tick.connect(tickFilter).connect(tickGain).connect(out);
      tick.start(barStart + beatToTime(beat));
    }
  });

  // Closing arpeggio ping over the final bar.
  const lastBar = beatToTime((BARS.length - 1) * 3);
  [62, 66, 69, 74].forEach((midi, i) => {
    playNote(ctx, out, midiToFreq(midi), lastBar + i * (SPB / 2), 1.2, {
      type: "sine",
      gain: 0.18,
      attack: 0.005,
      release: 0.9,
      cutoff: 4000,
    });
  });
}

async function renderStem(build: (ctx: OfflineAudioContext) => void): Promise<AudioBuffer> {
  const sampleRate = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(DAISY_DURATION * sampleRate), sampleRate);
  build(ctx);
  return ctx.startRendering();
}

export async function renderDaisyStems(): Promise<{
  vocals: AudioBuffer;
  instrumental: AudioBuffer;
}> {
  const [vocals, instrumental] = await Promise.all([
    renderStem(renderVocals),
    renderStem(renderInstrumental),
  ]);
  return { vocals, instrumental };
}
