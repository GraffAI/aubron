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
}

/**
 * "Load in a lawfully acquired MP3": reads ID3 metadata locally, looks up
 * timed lyrics (LRCLIB via /api/lyrics), and starts a session-local sing —
 * the audio never leaves the browser. Permanent, stem-separated library
 * entries go through the ingestion pipeline instead (see README).
 */
export function AddSong() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [note, setNote] = useState("");

  const acceptFile = async (file: File) => {
    setNote("");
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
    });
  };

  const sing = async () => {
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
          <div className="flex gap-2">
            <button
              onClick={() => void sing()}
              disabled={busy || !draft.title}
              className="flex-1 rounded-lg bg-neon px-3 py-2 text-sm font-medium text-black transition hover:brightness-110 disabled:opacity-40"
            >
              {busy ? "Finding timed lyrics…" : "Find lyrics & sing"}
            </button>
            <button
              onClick={() => setDraft(null)}
              className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/60"
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
          Drop a lawfully acquired MP3 here (or click) — metadata is read locally, timed lyrics are
          fetched, and you sing right away. The audio never leaves this tab.
        </button>
      )}
      {note ? <p className="text-xs text-red-400">{note}</p> : null}
      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
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
