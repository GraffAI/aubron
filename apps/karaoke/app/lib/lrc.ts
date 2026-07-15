import type { LyricLine, TimedWord } from "./types";

/**
 * LRC parser: standard line-timed LRC ("[mm:ss.xx] text") plus enhanced LRC
 * word tags ("<mm:ss.xx>word"). Multiple leading timestamps on one line (the
 * repeated-chorus shorthand) all get the same text. Metadata tags like
 * [ar:...] are ignored.
 */

const LINE_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/;

function tagToSeconds(min: string, sec: string, frac: string | undefined): number {
  // ".5" means 500ms, ".50" 500ms, ".500" 500ms — pad to milliseconds.
  const ms = frac ? Number(frac.padEnd(3, "0")) : 0;
  return Number(min) * 60 + Number(sec) + ms / 1000;
}

function parseWords(body: string, lineTime: number): { text: string; words?: TimedWord[] } {
  if (!WORD_TAG.test(body)) return { text: body.trim() };
  const words: TimedWord[] = [];
  // Split on word tags, keeping them: ["intro", "<0:01.0>", "Dai", ...]
  const parts = body.split(/(<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>)/);
  let time = lineTime;
  for (const part of parts) {
    const tag = WORD_TAG.exec(part);
    if (tag) {
      time = tagToSeconds(tag[1]!, tag[2]!, tag[3]);
      continue;
    }
    const text = part.trim();
    if (text) words.push({ time, text });
  }
  return { text: words.map((w) => w.text).join(" "), words };
}

export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    LINE_TAG.lastIndex = 0;
    const times: number[] = [];
    let match: RegExpExecArray | null;
    let bodyStart = 0;
    // Collect every leading [mm:ss.xx] tag; the body starts after the last one.
    while ((match = LINE_TAG.exec(raw)) !== null && match.index === bodyStart) {
      times.push(tagToSeconds(match[1]!, match[2]!, match[3]));
      bodyStart = LINE_TAG.lastIndex;
    }
    if (times.length === 0) continue; // metadata tag or free text
    const body = raw.slice(bodyStart);
    const { text, words } = parseWords(body, times[0]!);
    if (!text) continue;
    for (const time of times) lines.push(words ? { time, text, words } : { time, text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

/** Index of the line current at `time`, or -1 before the first line. */
export function lineIndexAt(lines: LyricLine[], time: number): number {
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.time <= time) index = i;
    else break;
  }
  return index;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
