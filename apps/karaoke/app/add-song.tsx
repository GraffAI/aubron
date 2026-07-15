"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { readId3 } from "./lib/id3";
import { addLocalSong } from "./lib/local-session";

interface Draft {
  title: string;
  artist: string;
  duration: number;
  data: ArrayBuffer;
  fileName: string;
  contentType: string;
}

type Phase =
  | { step: "idle" }
  | { step: "uploading" }
  | { step: "separating" }
  | { step: "added"; songId?: string }
  | { step: "failed"; message: string };

/** Pull the server's error detail out of a failed API response. */
async function apiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `${fallback} (${res.status})`;
  } catch {
    return `${fallback} (${res.status})`;
  }
}

/**
 * "Load in a lawfully acquired MP3": reads ID3 metadata locally, then either
 * sings it right now (session-local, audio never leaves the browser) or — when
 * private library storage is configured — ingests it: upload straight to the
 * bucket via a one-shot presigned PUT, then lyrics + stem separation run
 * server-side and the song lands in the collection.
 */
export function AddSong({ libraryEnabled }: { libraryEnabled: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const [note, setNote] = useState("");

  const acceptFile = async (file: File) => {
    setNote("");
    setPhase({ step: "idle" });
    const data = await file.arrayBuffer();
    const tags = readId3(data);
    // Decode a copy for the real duration (decodeAudioData detaches its input).
    let duration: number;
    try {
      const ctx = new AudioContext();
      duration = (await ctx.decodeAudioData(data.slice(0))).duration;
      void ctx.close();
    } catch {
      setNote("Couldn't decode that file — is it a real audio file?");
      return;
    }
    setDraft({
      title: tags.title ?? file.name.replace(/\.[^.]+$/, ""),
      artist: tags.artist ?? "",
      duration,
      data,
      fileName: file.name,
      contentType: file.type || "audio/mpeg",
    });
  };

  const singNow = async () => {
    if (!draft) return;
    setBusy(true);
    let lrc: string | null = null;
    try {
      if (draft.artist) {
        const params = new URLSearchParams({
          artist: draft.artist,
          title: draft.title,
          duration: String(Math.round(draft.duration)),
        });
        const res = await fetch(`/api/lyrics?${params}`);
        if (res.ok) {
          const body = (await res.json()) as { synced: string | null };
          lrc = body.synced;
        }
      }
    } catch {
      /* no lyrics is not fatal — instrumental karaoke is still karaoke */
    }
    const song = addLocalSong({
      title: draft.title,
      artist: draft.artist || "Unknown artist",
      duration: draft.duration,
      lrc,
      data: draft.data,
    });
    router.push(`/sing/${song.id}`);
  };

  const addToLibrary = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      setPhase({ step: "uploading" });
      const presign = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: draft.fileName, contentType: draft.contentType }),
      });
      if (!presign.ok) throw new Error(await apiError(presign, "upload not available"));
      const { key, url } = (await presign.json()) as { key: string; url: string };
      // The one cross-origin request in the whole flow. A CORS miss surfaces
      // as an opaque TypeError ("Load failed" on Safari) — translate it.
      const put = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": draft.contentType },
        body: draft.data,
      }).catch(() => null);
      if (!put) {
        throw new Error(
          `storage upload blocked — the bucket's CORS rule must allow PUT from ${window.location.origin}`,
        );
      }
      if (!put.ok) throw new Error(`storage upload failed (${put.status})`);

      const start = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          title: draft.title,
          artist: draft.artist || "Unknown artist",
          durationSeconds: Math.round(draft.duration),
        }),
      });
      if (!start.ok) throw new Error(await apiError(start, "ingest failed to start"));
      let state = (await start.json()) as {
        jobId: string;
        status: string;
        songId?: string;
        error?: string;
      };

      setPhase({ step: "separating" });
      while (state.status === "separating") {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const poll = await fetch(`/api/ingest/${state.jobId}`);
        if (!poll.ok) throw new Error("lost track of the ingest job");
        state = (await poll.json()) as typeof state;
      }
      if (state.status !== "done") throw new Error(state.error ?? "ingest failed");
      setPhase({ step: "added", songId: state.songId });
      setDraft(null);
      router.refresh(); // the collection list is server-rendered
    } catch (err) {
      setPhase({ step: "failed", message: err instanceof Error ? err.message : "ingest failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {draft ? (
        <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="truncate text-xs text-white/40">{draft.fileName}</p>
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Title"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-neon/60"
          />
          <input
            value={draft.artist}
            onChange={(e) => setDraft({ ...draft, artist: e.target.value })}
            placeholder="Artist (needed for the lyrics lookup)"
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-neon/60"
          />
          <div className="flex flex-wrap gap-2">
            {libraryEnabled ? (
              <button
                onClick={() => void addToLibrary()}
                disabled={busy || !draft.title}
                className="flex-1 rounded-lg bg-neon px-3 py-2 text-sm font-medium text-black transition hover:brightness-110 disabled:opacity-40"
              >
                {phase.step === "uploading"
                  ? "Uploading…"
                  : phase.step === "separating"
                    ? "Separating stems + timing lyrics…"
                    : "Add to library"}
              </button>
            ) : null}
            <button
              onClick={() => void singNow()}
              disabled={busy || !draft.title}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-40 ${
                libraryEnabled
                  ? "border border-white/15 text-white/80 hover:border-neon/60"
                  : "bg-neon text-black hover:brightness-110"
              }`}
            >
              {busy && !libraryEnabled ? "Finding timed lyrics…" : "Sing now (this tab only)"}
            </button>
            <button
              onClick={() => {
                setDraft(null);
                setPhase({ step: "idle" });
              }}
              disabled={busy}
              className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/60 disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) void acceptFile(file);
          }}
          className={`w-full rounded-2xl border border-dashed px-4 py-8 text-sm transition ${
            dragOver
              ? "border-neon bg-neon/10 text-white"
              : "border-white/20 text-white/50 hover:border-white/40"
          }`}
        >
          {libraryEnabled
            ? "Drop a lawfully acquired MP3 here (or click). Add it to the private library — stems separated, lyrics timed — or just sing it in this tab."
            : "Drop a lawfully acquired MP3 here (or click) — metadata is read locally, timed lyrics are fetched, and you sing right away. The audio never leaves this tab."}
        </button>
      )}
      {phase.step === "added" ? (
        <p className="rounded-lg border border-neon/30 bg-neon/10 px-3 py-2 text-xs text-neon">
          In the collection.{" "}
          {phase.songId ? (
            <a href={`/sing/${phase.songId}`} className="underline">
              Sing it now →
            </a>
          ) : null}
        </p>
      ) : null}
      {phase.step === "failed" ? (
        <p className="text-xs text-red-400">Ingest failed: {phase.message}</p>
      ) : null}
      {note ? <p className="text-xs text-red-400">{note}</p> : null}
      <input
        ref={inputRef}
        type="file"
        // iOS Safari greys out real audio files under a bare audio/* filter;
        // explicit extensions make the Files picker allow them. Anything that
        // slips through is still validated by the decode step above.
        accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.aiff"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void acceptFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
