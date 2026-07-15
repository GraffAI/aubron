import { parseLrc } from "./lrc";
import type { Song } from "./types";

/**
 * Session-local songs: an MP3 the user just dropped, playable immediately
 * without any server round-trip. The audio bytes never leave the browser —
 * they live in this module map for the tab's lifetime. No separation has run,
 * so the full mix rides the instrumental fader (the vocal fader is inert),
 * but with LRCLIB lyrics this is already usable karaoke.
 */

const store = new Map<string, { song: Song; data: ArrayBuffer }>();
let counter = 0;

export function addLocalSong(meta: {
  title: string;
  artist: string;
  duration: number;
  lrc: string | null;
  data: ArrayBuffer;
}): Song {
  const id = `local-${++counter}`;
  const lyrics = meta.lrc ? parseLrc(meta.lrc) : [];
  const song: Song = {
    id,
    title: meta.title,
    artist: meta.artist,
    duration: meta.duration,
    source: { kind: "local", objectUrl: "" },
    lyrics,
    wordTimed: lyrics.some((l) => l.words !== undefined),
  };
  store.set(id, { song, data: meta.data });
  return song;
}

export function getLocalSong(id: string): { song: Song; data: ArrayBuffer } | undefined {
  return store.get(id);
}
