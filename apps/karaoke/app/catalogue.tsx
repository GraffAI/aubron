"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { formatClock } from "./lib/lrc";
import {
  addEntry,
  moveEntry,
  removeEntry,
  setSinger,
  stashUpNext,
  updateQueue,
  useQueue,
} from "./lib/queue";
import type { LyricsStatus } from "./lib/types";

/** The light, serializable slice of a Song the catalogue needs — lyrics stay
 *  on the server; this is a browse surface, not a player. */
export interface CatalogueSong {
  id: string;
  title: string;
  artist: string;
  duration: number;
  wordTimed: boolean;
  hasLyrics: boolean;
  lyricsStatus?: LyricsStatus;
  addedAt?: string;
  artUrl?: string;
}

type Sort = "latest" | "title" | "artist";

/** Fold case + latin diacritics so "Beyonce" finds "Beyoncé". */
const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

/** Every song gets album art it never shipped with: a stable gradient from
 *  its id, so the catalogue reads as a wall of covers instead of a text list. */
function coverGradient(id: string): string {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.codePointAt(0)!) | 0;
  const h1 = ((hash % 360) + 360) % 360;
  const h2 = (h1 + 75) % 360;
  return `linear-gradient(135deg, hsl(${h1} 70% 45%), hsl(${h2} 85% 30%))`;
}

/** Real cover when the pipeline found one; the gradient sits underneath so a
 *  failed image load degrades invisibly instead of showing a broken glyph. */
export function Cover({
  id,
  artUrl,
  className,
}: {
  id: string;
  artUrl?: string;
  className: string;
}) {
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden text-white/80 ${className}`}
      style={{ background: coverGradient(id) }}
    >
      ♪
      {artUrl ? (
        // Plain <img>: an authed same-origin blob, already display-sized —
        // next/image optimization has nothing to add.
        <img
          src={artUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => e.currentTarget.remove()}
        />
      ) : null}
    </span>
  );
}

function Badge({ song }: { song: CatalogueSong }) {
  if (song.wordTimed)
    return (
      <span className="rounded-full border border-neon/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neon/80">
        word-timed
      </span>
    );
  if (song.hasLyrics)
    return (
      <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/50">
        timed
      </span>
    );
  return (
    <span
      className="rounded-full border border-amber-400/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-300/80"
      title={song.lyricsStatus === "plain-only" ? "lyrics found but untimed" : "no lyrics found"}
    >
      {song.lyricsStatus === "plain-only" ? "untimed" : "no lyrics"}
    </span>
  );
}

/**
 * The browse-and-queue half of the home page: search, sort, one row per song
 * with a generated cover, and the party queue above it all. Queue state is
 * shared with the player through localStorage (see lib/queue.ts).
 */
export function Catalogue({ songs }: { songs: CatalogueSong[] }) {
  const router = useRouter();
  const queue = useQueue();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("latest");

  const shown = useMemo(() => {
    const q = fold(query.trim());
    const filtered = q
      ? songs.filter((s) => fold(`${s.title} ${s.artist}`).includes(q))
      : [...songs];
    switch (sort) {
      case "title":
        return filtered.sort((a, b) => a.title.localeCompare(b.title));
      case "artist":
        return filtered.sort(
          (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
        );
      default:
        // Newest ingest first; songs without a timestamp (demo, file library)
        // keep their catalog order at the end.
        return filtered.sort((a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? ""));
    }
  }, [songs, query, sort]);

  const knownIds = useMemo(() => new Set(songs.map((s) => s.id)), [songs]);

  /** Head-of-queue "Sing now": consume the entry, then go perform it. */
  const singNow = (entryId: string) => {
    const entry = queue.find((e) => e.id === entryId);
    if (!entry) return;
    updateQueue((list) => removeEntry(list, entryId));
    stashUpNext(entry);
    router.push(`/sing/${entry.songId}`);
  };

  return (
    <div className="space-y-8">
      {queue.length > 0 ? (
        <section className="space-y-2" data-queue-panel>
          <div className="flex items-baseline justify-between">
            <h2 className="text-xs font-medium uppercase tracking-widest text-white/40">
              Up next{" "}
              <span className="text-neon">
                · {queue.length} {queue.length === 1 ? "song" : "songs"}
              </span>
            </h2>
            <button
              onClick={() => updateQueue(() => [])}
              className="text-[11px] text-white/30 transition hover:text-red-300"
            >
              clear queue
            </button>
          </div>
          <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-neon/20 bg-neon/[0.03]">
            {queue.map((entry, i) => (
              <li key={entry.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-5 shrink-0 text-center text-xs tabular-nums text-white/30">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span dir="auto" className="block truncate text-sm font-medium">
                    {entry.title}
                    {!knownIds.has(entry.songId) ? (
                      <span className="ml-2 text-[10px] uppercase text-red-300/80">
                        no longer in library
                      </span>
                    ) : null}
                  </span>
                  <input
                    dir="auto"
                    value={entry.singer}
                    onChange={(e) =>
                      updateQueue((list) => setSinger(list, entry.id, e.target.value))
                    }
                    placeholder="Who's singing?"
                    data-singer-input
                    className="mt-0.5 w-full max-w-48 rounded border-none bg-transparent p-0 text-xs text-neon/90 placeholder:text-white/25 focus:outline-none"
                  />
                </span>
                {i === 0 && knownIds.has(entry.songId) ? (
                  <button
                    onClick={() => singNow(entry.id)}
                    data-sing-now
                    className="rounded-full bg-neon px-3 py-1 text-xs font-medium text-black transition hover:brightness-110"
                  >
                    Sing now
                  </button>
                ) : null}
                <span className="flex shrink-0 gap-1 text-white/40">
                  <button
                    onClick={() => updateQueue((list) => moveEntry(list, entry.id, -1))}
                    disabled={i === 0}
                    aria-label="Move up"
                    className="grid h-6 w-6 place-items-center rounded transition hover:bg-white/10 hover:text-white disabled:opacity-25"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => updateQueue((list) => moveEntry(list, entry.id, 1))}
                    disabled={i === queue.length - 1}
                    aria-label="Move down"
                    className="grid h-6 w-6 place-items-center rounded transition hover:bg-white/10 hover:text-white disabled:opacity-25"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => updateQueue((list) => removeEntry(list, entry.id))}
                    aria-label="Remove from queue"
                    className="grid h-6 w-6 place-items-center rounded transition hover:bg-white/10 hover:text-red-300"
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-snug text-white/30">
            When a song ends, the player loads the next one and waits — nothing plays until the
            singer presses ▶.
          </p>
        </section>
      ) : null}

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-xs font-medium uppercase tracking-widest text-white/40">
            Collection <span className="text-white/25">· {songs.length}</span>
          </h2>
          {(["latest", "title", "artist"] as const).map((key) => (
            <button
              key={key}
              onClick={() => setSort(key)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                sort === key
                  ? "border-neon/50 text-neon"
                  : "border-white/10 text-white/40 hover:text-white"
              }`}
            >
              {key}
            </button>
          ))}
        </div>
        <input
          dir="auto"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search title or artist…"
          className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm outline-none transition focus:border-neon/60"
        />
        {shown.length === 0 ? (
          <p className="rounded-2xl border border-white/10 px-4 py-6 text-center text-sm text-white/40">
            Nothing matches “{query}” — try fewer letters, or add it below.
          </p>
        ) : (
          <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10">
            {shown.map((song) => (
              <li
                key={song.id}
                className="flex items-center gap-4 px-4 py-3 transition hover:bg-white/5"
              >
                <Link href={`/sing/${song.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                  <Cover id={song.id} artUrl={song.artUrl} className="h-10 w-10 rounded-lg" />
                  <span className="min-w-0 flex-1">
                    <span dir="auto" className="block truncate font-medium">
                      {song.title}
                    </span>
                    <span dir="auto" className="block truncate text-xs text-white/40">
                      {song.artist}
                    </span>
                  </span>
                  <Badge song={song} />
                  <span className="text-xs tabular-nums text-white/40">
                    {formatClock(song.duration)}
                  </span>
                </Link>
                <button
                  onClick={() => updateQueue((list) => addEntry(list, song))}
                  data-queue={song.id}
                  aria-label={`Add ${song.title} to queue`}
                  className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/60 transition hover:border-neon/60 hover:text-neon"
                >
                  + Queue
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
