/**
 * Core domain types. A Song is a manifest: where its stems live, what its
 * timed lyrics are, and enough metadata to render the library. Stems are the
 * output of source separation (vocals + everything-else at minimum).
 */

/** One word inside a lyric line, timed for word-sweep highlighting. */
export interface TimedWord {
  /** Seconds from song start when the word begins. */
  time: number;
  text: string;
}

/** One lyric line. `words` is present when word-level timing is known. */
export interface LyricLine {
  /** Seconds from song start when the line becomes current. */
  time: number;
  text: string;
  words?: TimedWord[];
}

export type StemKind = "vocals" | "instrumental" | "full";

/**
 * Where a song's audio comes from.
 * - `builtin`  — synthesized locally (the public-domain demo song).
 * - `stems`    — separated stem files, the real karaoke experience. When
 *                `full` (the untouched original) is present, the player
 *                crossfades full ↔ instrumental so the vocal fader at max is
 *                bit-exact the real song — separation residue can't lose
 *                content. `vocals` is kept for alignment/practice use.
 * - `local`    — a file the user dropped this session (no separation; the
 *                full mix plays as "instrumental" and the vocals fader is inert).
 */
export type SongSource =
  | { kind: "builtin"; id: "daisy-bell" }
  | { kind: "stems"; urls: { vocals?: string; instrumental: string; full?: string } }
  | { kind: "local"; objectUrl: string };

export interface Song {
  id: string;
  title: string;
  artist: string;
  /** Seconds; 0 = unknown until decoded. */
  duration: number;
  source: SongSource;
  lyrics: LyricLine[];
  /** Set when lyrics carry word-level times (enhanced LRC). */
  wordTimed: boolean;
  /** Lyric-pipeline outcome for library badges (stored songs only). */
  lyricsStatus?: LyricsStatus;
}

/** Entry in a deployed library manifest (`public/library/index.json`). */
export interface LibraryEntry {
  id: string;
  title: string;
  artist: string;
  duration: number;
  /** Paths relative to `/library/<id>/`, e.g. "vocals.m4a". */
  stems: Record<StemKind, string>;
  /** Path to an .lrc file relative to `/library/<id>/`. */
  lrc: string;
}

/** Entry in the private-bucket manifest (`library/index.json`) written by the
 *  ingestion pipeline. Stem values are bucket keys, never URLs — the client
 *  only ever sees the authed /api/stems proxy. */
export interface StoredLibraryEntry {
  id: string;
  title: string;
  artist: string;
  duration: number;
  stems: { vocals?: string; instrumental: string; full?: string };
  /** LRC text inlined so the whole library is one JSON read. */
  lrc: string | null;
  /** Outcome of the lyric lookup, for at-a-glance library badges. */
  lyricsStatus?: LyricsStatus;
  addedAt: string;
}

export type LyricsStatus = "synced" | "plain-only" | "not-found" | "error";

/** Full account of one lyric lookup — stored in the per-song ingest report
 *  so "did lyrics work, and if not why" is answerable from any device. */
export interface LyricsReport {
  status: LyricsStatus;
  synced: string | null;
  plain: string | null;
  /** Which provider path produced the result, e.g. "lrclib:get". */
  source: string | null;
  query: { artist: string; title: string; duration?: number };
  /** One line per provider request, e.g. "GET lrclib.net/api/get → 404". */
  attempts: string[];
}

/** Per-song pipeline report, stored at `library/<songId>/ingest.json`. */
export interface IngestReport {
  jobId: string;
  originalKey: string;
  addedAt: string;
  lyrics: LyricsReport | null;
  separation: { used: boolean; note: string };
  stems: { vocals?: string; instrumental: string; full?: string };
}

/** Ingest job state, persisted in the bucket (`jobs/<id>.json`) so any
 *  serverless instance can pick up a poll. */
export interface IngestJob {
  id: string;
  /** Bucket key of the uploaded original. */
  key: string;
  title: string;
  artist: string;
  duration: number;
  lrc: string | null;
  /** Full lyric-lookup report (absent on jobs from older deploys). */
  lyrics?: LyricsReport | null;
  /** Separation prediction URL to poll, or null when running without one. */
  predictionUrl: string | null;
  /** Why separation was skipped, when it was. */
  separationNote?: string;
  status: "separating" | "done" | "error";
  songId?: string;
  error?: string;
}
