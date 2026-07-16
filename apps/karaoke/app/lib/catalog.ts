import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { daisySong } from "./daisy";
import { parseLrc } from "./lrc";
import { getJson, isStorageConfigured } from "./storage";
import type { LibraryEntry, Song, StoredLibraryEntry } from "./types";

/**
 * The song collection = the built-in demo song + whatever the deployed library
 * manifest lists. The library lives under `public/library/`:
 *
 *   public/library/index.json          — LibraryEntry[]
 *   public/library/<id>/vocals.m4a     — separated vocal stem
 *   public/library/<id>/backing.m4a    — separated instrumental stem
 *   public/library/<id>/lyrics.lrc     — timed lyrics (enhanced LRC welcome)
 *
 * Those files are produced by the ingestion pipeline (see pipeline.ts) from
 * lawfully acquired audio, and they sit behind the auth middleware. Swapping
 * this directory for object storage (Vercel Blob / S3) only changes the URLs
 * in the manifest — the player just fetches and decodes.
 */

const LIBRARY_DIR = join(process.cwd(), "public", "library");

async function loadLibrary(): Promise<Song[]> {
  let entries: LibraryEntry[];
  try {
    entries = JSON.parse(await readFile(join(LIBRARY_DIR, "index.json"), "utf8")) as LibraryEntry[];
  } catch {
    return []; // no deployed library — demo song only
  }
  const songs = await Promise.all(
    entries.map(async (entry): Promise<Song | null> => {
      try {
        const lrc = await readFile(join(LIBRARY_DIR, entry.id, entry.lrc), "utf8");
        const lyrics = parseLrc(lrc);
        return {
          id: entry.id,
          title: entry.title,
          artist: entry.artist,
          duration: entry.duration,
          source: {
            kind: "stems",
            urls: {
              vocals: `/library/${entry.id}/${entry.stems.vocals}`,
              instrumental: `/library/${entry.id}/${entry.stems.instrumental}`,
            },
          },
          lyrics,
          wordTimed: lyrics.some((l) => l.words !== undefined),
        };
      } catch {
        return null; // broken entry: skip rather than take the library down
      }
    }),
  );
  return songs.filter((s) => s !== null);
}

/** Songs ingested into the private bucket; stems play via the authed proxy. */
async function loadStoredLibrary(): Promise<Song[]> {
  if (!isStorageConfigured()) return [];
  let entries: StoredLibraryEntry[];
  try {
    entries = (await getJson<StoredLibraryEntry[]>("library/index.json")) ?? [];
  } catch {
    return []; // bucket unreachable: keep the rest of the library up
  }
  return entries.map((entry) => {
    const lyrics = entry.lrc ? parseLrc(entry.lrc) : [];
    return {
      id: entry.id,
      title: entry.title,
      artist: entry.artist,
      duration: entry.duration,
      source: {
        kind: "stems" as const,
        urls: {
          ...(entry.stems.vocals ? { vocals: `/api/stems/${entry.id}/vocals` } : {}),
          ...(entry.stems.full ? { full: `/api/stems/${entry.id}/full` } : {}),
          instrumental: `/api/stems/${entry.id}/instrumental`,
        },
      },
      lyrics,
      wordTimed: lyrics.some((l) => l.words !== undefined),
      lyricsStatus:
        entry.lyricsStatus ?? (entry.lrc ? ("synced" as const) : ("not-found" as const)),
    };
  });
}

export async function getSongs(): Promise<Song[]> {
  const [files, stored] = await Promise.all([loadLibrary(), loadStoredLibrary()]);
  return [daisySong, ...stored, ...files];
}

export async function getSong(id: string): Promise<Song | undefined> {
  return (await getSongs()).find((s) => s.id === id);
}
