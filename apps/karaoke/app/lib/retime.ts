import { parseLrc } from "./lrc";

/**
 * Timing transplant: keep the CHOSEN lyric text as truth, take WhisperX's
 * word timestamps, and marry them. Whisper transcribes what it hears — great
 * timing, unreliable words (mondegreens, ad-libs, censored terms); lyric
 * providers have the opposite trade. Sequence-aligning the two word streams
 * (Needleman–Wunsch over normalized tokens) anchors most lyric words to a
 * heard timestamp; the stragglers interpolate between anchors. The output is
 * enhanced LRC: provider words, AI timing.
 */

export interface TimedToken {
  word: string;
  start: number;
}

const norm = (w: string) =>
  w
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "");

// Han, kana, and halfwidth-kana ranges: scripts written without spaces, where
// "word" must mean "character" for any whitespace-based matching to work.
const CJK_RANGES =
  "\\u2E80-\\u2EFF\\u3000-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFF66-\\uFF9F";
const CJK_CHAR = new RegExp(`[${CJK_RANGES}]`);
const CJK_SPLIT = new RegExp(`([${CJK_RANGES}])`, "u");

/** Whitespace token → matchable subtokens: CJK runs split per character so
 *  Japanese/Chinese lines (no spaces) don't collapse into one giant "word". */
function subTokens(raw: string): string[] {
  if (!CJK_CHAR.test(raw)) return [raw];
  return raw.split(CJK_SPLIT).filter((s) => s.length > 0);
}

/** Strip line/word tags from LRC (or pass plain text through) → text lines. */
export function lyricsToPlainLines(text: string): string[] {
  const parsed = parseLrc(text);
  if (parsed.length > 0) return parsed.map((l) => l.text);
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^\[[a-z]+:/i.test(l)); // drop metadata tags
}

/** Global alignment; returns for each `a` index the matched `b` index or -1.
 *  Only exact normalized matches become anchors. */
function alignSequences(a: string[], b: string[]): number[] {
  const m = a.length;
  const n = b.length;
  const cols = n + 1;
  const score = new Int32Array((m + 1) * cols);
  const move = new Uint8Array((m + 1) * cols); // 1 diag, 2 up (skip a), 3 left (skip b)
  const GAP = -1;
  for (let i = 1; i <= m; i++) {
    score[i * cols] = i * GAP;
    move[i * cols] = 2;
  }
  for (let j = 1; j <= n; j++) {
    score[j] = j * GAP;
    move[j] = 3;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const eq = a[i - 1] === b[j - 1] && a[i - 1]!.length > 0;
      const diag = score[(i - 1) * cols + (j - 1)]! + (eq ? 2 : -1);
      const up = score[(i - 1) * cols + j]! + GAP;
      const left = score[i * cols + (j - 1)]! + GAP;
      const best = Math.max(diag, up, left);
      score[i * cols + j] = best;
      move[i * cols + j] = best === diag ? 1 : best === up ? 2 : 3;
    }
  }
  const match = new Array<number>(m).fill(-1);
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    const d = move[i * cols + j];
    if (d === 1) {
      if (a[i - 1] === b[j - 1] && a[i - 1]!.length > 0) match[i - 1] = j - 1;
      i--;
      j--;
    } else if (d === 2) i--;
    else j--;
  }
  return match;
}

const lrcTime = (seconds: number) => {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${(s - m * 60).toFixed(2).padStart(5, "0")}`;
};

/**
 * Timed words → enhanced LRC with heuristic line breaks (a singing pause of
 * >1.4s or 8 words, whichever first). For the no-sheet path, where a
 * transcriber returns a flat word stream with no line structure.
 */
export function wordsToLrc(words: TimedToken[]): string | null {
  const clean = words.filter((w) => w.word.trim().length > 0 && Number.isFinite(w.start));
  if (clean.length === 0) return null;
  const lines: TimedToken[][] = [];
  let current: TimedToken[] = [];
  let last = clean[0]!.start;
  for (const w of clean) {
    if (current.length >= 8 || (current.length > 0 && w.start - last > 1.4)) {
      lines.push(current);
      current = [];
    }
    current.push(w);
    last = w.start;
  }
  if (current.length > 0) lines.push(current);
  return lines
    .map(
      (lw) =>
        `[${lrcTime(lw[0]!.start)}]` + lw.map((w) => `<${lrcTime(w.start)}>${w.word}`).join(" "),
    )
    .join("\n");
}

/**
 * Map a forced-aligner's output DIRECTLY onto the sheet it was given. The
 * aligner's tokens are substrings of our own text in order, so a cursor walk
 * places each on its line — no whitespace assumptions, which is what makes
 * Japanese (spaceless) and Arabic sheets work. Returns null when too many
 * tokens fail to place (the aligner returned something else entirely).
 */
export function alignedWordsToLrc(seedText: string, tokens: TimedToken[]): string | null {
  const lines = lyricsToPlainLines(seedText);
  const clean = tokens.filter((t) => t.word.trim().length > 0 && Number.isFinite(t.start));
  if (lines.length === 0 || clean.length === 0) return null;

  const perLine: TimedToken[][] = lines.map(() => []);
  let lineIdx = 0;
  let offset = 0;
  let misses = 0;
  for (const t of clean) {
    const token = t.word.trim();
    let placed = false;
    for (let li = lineIdx; li < lines.length && li <= lineIdx + 2; li++) {
      const from = li === lineIdx ? offset : 0;
      const at = lines[li]!.indexOf(token, from);
      // "Nearby" guard: a token that only matches far ahead is likely a
      // mismatch (e.g. a repeated chorus word) — don't let it skip content.
      if (at >= 0 && at - from <= 32) {
        perLine[li]!.push({ word: token, start: t.start });
        lineIdx = li;
        offset = at + token.length;
        placed = true;
        break;
      }
    }
    if (!placed) misses++;
  }
  if (misses / clean.length > 0.25) return null;

  // Aligners are monotonic, but enforce it across line boundaries anyway.
  let lastTime = 0;
  const out: string[] = [];
  for (const lineTokens of perLine) {
    if (lineTokens.length === 0) continue;
    for (const t of lineTokens) {
      if (t.start < lastTime) t.start = lastTime;
      lastTime = t.start;
    }
    const body = lineTokens.map((t) => `<${lrcTime(t.start)}>${t.word}`).join(" ");
    out.push(`[${lrcTime(lineTokens[0]!.start)}]${body}`);
  }
  return out.length > 0 ? out.join("\n") : null;
}

/**
 * Retime `lyricsText` (plain or LRC) using Whisper's heard words. Returns
 * enhanced LRC, or null when too few words anchor (< 35%) — a sign Whisper
 * heard a different song than the sheet claims, where transplanted timing
 * would be worse than whatever we already have.
 */
export function retimeLyrics(
  lyricsText: string,
  heard: TimedToken[],
  minMatch = 0.35,
): string | null {
  const lines = lyricsToPlainLines(lyricsText);
  const words: { text: string; line: number }[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    for (const raw of line.split(/\s+/)) {
      for (const sub of subTokens(raw.trim())) {
        if (sub) words.push({ text: sub, line: lineIndex });
      }
    }
  }
  const heardClean = heard
    .flatMap((h) =>
      subTokens(h.word.trim()).map((sub) => ({ word: sub, start: h.start }) as TimedToken),
    )
    .filter((h) => Number.isFinite(h.start) && norm(h.word).length > 0);
  // Cap the DP so pathological inputs can't chew serverless memory.
  if (
    words.length === 0 ||
    heardClean.length === 0 ||
    words.length > 1500 ||
    heardClean.length > 1500
  ) {
    return null;
  }

  const match = alignSequences(
    words.map((w) => norm(w.text)),
    heardClean.map((h) => norm(h.word)),
  );
  const anchored = match.filter((x) => x >= 0).length;
  if (anchored / words.length < minMatch) return null;

  // Assign times: anchors take Whisper's start; gaps interpolate between the
  // surrounding anchors by word position; enforce monotonicity.
  const times = new Array<number>(words.length).fill(NaN);
  for (let k = 0; k < words.length; k++) {
    if (match[k]! >= 0) times[k] = heardClean[match[k]!]!.start;
  }
  let prevIdx = -1;
  for (let k = 0; k <= words.length; k++) {
    const isAnchor = k < words.length && !Number.isNaN(times[k]);
    if (!isAnchor && k < words.length) continue;
    const nextIdx = k < words.length ? k : -1;
    const from = prevIdx >= 0 ? times[prevIdx]! : nextIdx >= 0 ? times[nextIdx]! : 0;
    const to = nextIdx >= 0 ? times[nextIdx]! : from;
    const span = nextIdx >= 0 && prevIdx >= 0 ? nextIdx - prevIdx : 1;
    for (let g = prevIdx + 1; g < (nextIdx >= 0 ? nextIdx : words.length); g++) {
      const frac = span > 0 ? (g - prevIdx) / span : 0;
      times[g] = from + (to - from) * frac;
    }
    prevIdx = k;
  }
  for (let k = 1; k < times.length; k++) {
    if (times[k]! < times[k - 1]!) times[k] = times[k - 1]!;
  }

  const out: string[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    void line;
    const lineWords = words
      .map((w, k) => ({ ...w, time: times[k]! }))
      .filter((w) => w.line === lineIndex);
    if (lineWords.length === 0) continue;
    const body = lineWords.map((w) => `<${lrcTime(w.time)}>${w.text}`).join(" ");
    out.push(`[${lrcTime(lineWords[0]!.time)}]${body}`);
  }
  return out.length > 0 ? out.join("\n") : null;
}
