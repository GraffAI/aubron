import Link from "next/link";

import { AddSong } from "./add-song";
import { isAuthEnabled } from "./lib/auth";
import { getSongs } from "./lib/catalog";
import { formatClock } from "./lib/lrc";

// The library manifest and the auth banner both reflect runtime state.
export const dynamic = "force-dynamic";

export default async function Library() {
  const songs = await getSongs();
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="space-y-1">
        <h1 className="font-display text-4xl tracking-tight">
          aubron <span className="text-neon">karaoke</span>
        </h1>
        <p className="text-sm text-white/40">
          Stem-split playback · live mic mixing · word-timed lyrics · a retro mode with all the
          downsides lovingly preserved.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-widest text-white/40">Collection</h2>
        <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10">
          {songs.map((song) => (
            <li key={song.id}>
              <Link
                href={`/sing/${song.id}`}
                className="flex items-center gap-4 px-4 py-3 transition hover:bg-white/5"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-neon/15 text-neon">
                  ♪
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{song.title}</span>
                  <span className="block truncate text-xs text-white/40">{song.artist}</span>
                </span>
                {song.wordTimed ? (
                  <span className="rounded-full border border-neon/30 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neon/80">
                    word-timed
                  </span>
                ) : null}
                <span className="text-xs tabular-nums text-white/40">
                  {formatClock(song.duration)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-widest text-white/40">
          Sing something of yours
        </h2>
        <AddSong />
        <p className="text-[11px] leading-snug text-white/30">
          Dropped files play as-is (no stem separation in the browser). To add a song to the shared
          collection with separated vocals — the full experience — run it through the ingestion
          pipeline: <code className="text-white/50">POST /api/ingest</code>, then commit the stems
          to <code className="text-white/50">public/library/</code>. Details in the README.
        </p>
      </section>

      {!isAuthEnabled() && (
        <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs text-amber-200/70">
          Auth is off (KARAOKE_PASSCODE is not set). Fine for the built-in public-domain demo, but
          set a passcode before deploying a real library — lawfully acquired ≠ lawfully
          redistributed.
        </p>
      )}
    </main>
  );
}
