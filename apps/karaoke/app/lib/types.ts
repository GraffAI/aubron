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

export type StemKind = "vocals" | "instrumental";

/**
 * Where a song's audio comes from.
 * - `builtin`  — synthesized locally (the public-domain demo song).
 * - `stems`    — separated stem files, the real karaoke experience. `vocals`
 *                is optional: a library entry ingested before a separation
 *                provider was configured plays its full mix as backing.
 * - `local`    — a file the user dropped this session (no separation; the
 *                full mix plays as "instrumental" and the vocals fader is inert).
 */
export type SongSource =
  | { kind: "builtin"; id: "daisy-bell" }
  | { kind: "stems"; urls: { vocals?: string; instrumental: string } }
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
  stems: { vocals?: string; instrumental: string };
  /** LRC text inlined so the whole library is one JSON read. */
  lrc: string | null;
  addedAt: string;
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
  /** Separation prediction URL to poll, or null when running without one. */
  predictionUrl: string | null;
  status: "separating" | "done" | "error";
  songId?: string;
  error?: string;
}
