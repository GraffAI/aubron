"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { IngestReport, LyricsReport, LyricsStatus, Song } from "./lib/types";

interface Diagnostics {
  song: {
    id: string;
    title: string;
    artist: string;
    duration: number;
    addedAt: string;
    lyricsStatus: LyricsStatus;
    lyricLines: number;
    stems: string[];
  };
  ingest: IngestReport | null;
}

const STATUS_LABEL: Record<LyricsStatus, string> = {
  synced: "synced ✓",
  "plain-only": "found, but untimed",
  "not-found": "not found",
  error: "lookup error",
};

const STATUS_CLASS: Record<LyricsStatus, string> = {
  synced: "border-neon/40 text-neon",
  "plain-only": "border-amber-400/40 text-amber-300",
  "not-found": "border-red-400/40 text-red-300",
  error: "border-red-400/40 text-red-300",
};

function StatusChip({ status }: { status: LyricsStatus }) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_CLASS[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * The ⓘ panel: everything the pipeline knows about this song — lyric lookup
 * outcome (with per-request attempts when it failed), separation note, stem
 * inventory — plus a retry form, since a missed lookup is usually just
 * metadata mismatch. Sized for phones: full-screen sheet, scrollable.
 */
export function SongInfo({ song }: { song: Song }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const stored =
    song.source.kind === "stems" && song.source.urls.instrumental.startsWith("/api/stems/");
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [diagError, setDiagError] = useState("");
  const [artist, setArtist] = useState(song.artist);
  const [title, setTitle] = useState(song.title);
  const [retrying, setRetrying] = useState(false);
  const [retryResult, setRetryResult] = useState<(LyricsReport & { updated: boolean }) | null>(
    null,
  );

  useEffect(() => {
    if (!open || !stored) return;
    setDiagError("");
    fetch(`/api/songs/${song.id}/diagnostics`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`diagnostics unavailable (${res.status})`);
        setDiag((await res.json()) as Diagnostics);
      })
      .catch((err: unknown) => setDiagError(err instanceof Error ? err.message : "failed to load"));
  }, [open, stored, song.id]);

  const [managing, setManaging] = useState<"idle" | "reprocessing" | "deleting" | "done">("idle");
  const [manageMsg, setManageMsg] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  /** Re-run separation + lyric lookup in place, then reload the song. */
  const reprocess = async () => {
    setManaging("reprocessing");
    setManageMsg("");
    try {
      const res = await fetch(`/api/songs/${song.id}/reprocess`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `reprocess failed (${res.status})`);
      }
      let state = (await res.json()) as { jobId: string; status: string; error?: string };
      while (state.status === "separating") {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const poll = await fetch(`/api/ingest/${state.jobId}`);
        if (!poll.ok) throw new Error("lost track of the reprocess job");
        state = (await poll.json()) as typeof state;
      }
      if (state.status !== "done") throw new Error(state.error ?? "reprocess failed");
      setManaging("done");
      setManageMsg("✓ Reprocessed — reload the song to hear the new stems.");
      router.refresh();
    } catch (err) {
      setManaging("idle");
      setManageMsg(err instanceof Error ? err.message : "reprocess failed");
    }
  };

  /** Two-tap delete: arm, then destroy and go home. */
  const removeSong = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 4000);
      return;
    }
    setManaging("deleting");
    setManageMsg("");
    try {
      const res = await fetch(`/api/songs/${song.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`delete failed (${res.status})`);
      router.push("/");
      router.refresh();
    } catch (err) {
      setManaging("idle");
      setConfirmDelete(false);
      setManageMsg(err instanceof Error ? err.message : "delete failed");
    }
  };

  const retry = async () => {
    setRetrying(true);
    setRetryResult(null);
    try {
      const res = await fetch(`/api/songs/${song.id}/lyrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artist, title }),
      });
      if (!res.ok) throw new Error(`retry failed (${res.status})`);
      const result = (await res.json()) as LyricsReport & { updated: boolean };
      setRetryResult(result);
      if (result.updated) router.refresh();
    } catch (err) {
      setDiagError(err instanceof Error ? err.message : "retry failed");
    } finally {
      setRetrying(false);
    }
  };

  const localStatus: LyricsStatus = song.lyrics.length > 0 ? "synced" : "not-found";
  const lyrics = diag?.ingest?.lyrics ?? null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Song info & diagnostics"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/15 text-sm text-white/60 transition hover:text-white"
      >
        i
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="mx-auto mt-auto flex max-h-[85dvh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-t-2xl border border-white/10 bg-[#0b0e14] p-5 md:my-auto md:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate font-medium">{song.title}</h2>
                <p className="truncate text-xs text-white/40">{song.artist}</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-white/40 hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-medium uppercase tracking-widest text-white/40">
                  Lyrics
                </h3>
                <StatusChip status={diag?.song.lyricsStatus ?? localStatus} />
                {song.wordTimed ? (
                  <span className="text-[11px] text-white/40">word-timed</span>
                ) : null}
              </div>
              <p className="text-xs text-white/50">
                {song.lyrics.length > 0
                  ? `${song.lyrics.length} timed lines loaded.`
                  : "No timed lyrics — the song plays, the screen stays quiet."}
              </p>
              {lyrics ? (
                <div className="space-y-1 rounded-lg bg-white/5 p-3 text-xs text-white/50">
                  <p>
                    Searched for <span className="text-white/80">{lyrics.query.artist}</span> —{" "}
                    <span className="text-white/80">{lyrics.query.title}</span>
                    {lyrics.query.duration ? ` (${lyrics.query.duration}s)` : ""}
                    {lyrics.source ? ` · hit via ${lyrics.source}` : ""}
                  </p>
                  {lyrics.attempts.map((a, i) => (
                    <p key={i} className="font-mono text-[11px] text-white/40">
                      {a}
                    </p>
                  ))}
                </div>
              ) : null}
              {stored ? (
                <div className="space-y-2 rounded-lg border border-white/10 p-3">
                  <p className="text-xs text-white/50">
                    Missed lyrics are usually a metadata mismatch — fix the names and search again:
                  </p>
                  <input
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                    placeholder="Artist"
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-neon/60"
                  />
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Title"
                    className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-neon/60"
                  />
                  <button
                    onClick={() => void retry()}
                    disabled={retrying || !artist.trim() || !title.trim()}
                    className="w-full rounded-lg bg-neon px-3 py-2 text-sm font-medium text-black transition hover:brightness-110 disabled:opacity-40"
                  >
                    {retrying ? "Searching…" : "Search lyrics again"}
                  </button>
                  {retryResult ? (
                    <p
                      className={`text-xs ${retryResult.updated ? "text-neon" : "text-amber-300"}`}
                    >
                      {retryResult.updated
                        ? "Synced lyrics found and saved — reload the song to sing with them."
                        : `Still ${STATUS_LABEL[retryResult.status]}: ${retryResult.attempts.join(" · ")}`}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </section>

            {stored ? (
              <section className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-widest text-white/40">
                  Pipeline
                </h3>
                {diag ? (
                  <div className="space-y-1 text-xs text-white/50">
                    <p>
                      Stems:{" "}
                      {diag.song.stems.map((s) => (
                        <span
                          key={s}
                          className="mr-1 rounded bg-white/10 px-1.5 py-0.5 text-white/70"
                        >
                          {s}
                        </span>
                      ))}
                    </p>
                    <p>Separation: {diag.ingest?.separation.note ?? "no report stored"}</p>
                    <p>Added {new Date(diag.song.addedAt).toLocaleString()}</p>
                  </div>
                ) : diagError ? (
                  <p className="text-xs text-red-400">{diagError}</p>
                ) : (
                  <p className="text-xs text-white/40">Loading…</p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={() => void reprocess()}
                    disabled={managing !== "idle"}
                    className="flex-1 rounded-lg border border-white/15 px-3 py-2 text-sm text-white/80 transition hover:border-neon/60 disabled:opacity-40"
                  >
                    {managing === "reprocessing"
                      ? "Reprocessing…"
                      : "Reprocess (separation + lyrics)"}
                  </button>
                  <button
                    onClick={() => void removeSong()}
                    disabled={managing === "reprocessing" || managing === "deleting"}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition disabled:opacity-40 ${
                      confirmDelete
                        ? "border-red-400 bg-red-400/20 text-red-200"
                        : "border-red-400/40 text-red-300 hover:border-red-400"
                    }`}
                  >
                    {managing === "deleting"
                      ? "Deleting…"
                      : confirmDelete
                        ? "Tap again to really delete"
                        : "Delete from library"}
                  </button>
                </div>
                {manageMsg ? (
                  <p
                    className={`text-xs ${manageMsg.startsWith("✓") ? "text-neon" : "text-red-400"}`}
                  >
                    {manageMsg}
                  </p>
                ) : null}
              </section>
            ) : (
              <p className="text-xs text-white/40">
                {song.source.kind === "builtin"
                  ? "Built-in demo song — synthesized locally, no pipeline involved."
                  : "Session-local song — nothing stored, so no pipeline report."}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
