"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { IngestPreview } from "./ingest-preview";
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

type StepId = "upload" | "lyrics" | "separate" | "align";
type StepState = "pending" | "active" | "done" | "skip" | "fail";

interface Step {
  id: StepId;
  label: string;
  state: StepState;
  detail: string;
}

type Phase =
  | { step: "idle" }
  | { step: "working" }
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

/** PUT with real upload progress — fetch can't report it, XHR can. */
function putWithProgress(
  url: string,
  data: ArrayBuffer,
  contentType: string,
  onProgress: (fraction: number) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => resolve(xhr.status);
    xhr.onerror = () => reject(new Error("network"));
    xhr.send(data);
  });
}

const LYRIC_RESULT: Record<string, string> = {
  synced: "synced lyrics found (LRCLIB) ✓",
  "plain-only": "lyrics found but untimed",
  "not-found": "no community lyrics",
  error: "lyric provider unreachable",
};

/**
 * "Load in a lawfully acquired MP3": reads ID3 metadata locally, then either
 * sings it right now (session-local, audio never leaves the browser) or —
 * when private library storage is configured — ingests it with staged,
 * visible progress: upload % → lyric lookup result → stem separation →
 * optional WhisperX word timing → an in-flow preview of the processed song.
 */
export function AddSong({
  libraryEnabled,
  alignmentEnabled,
}: {
  libraryEnabled: boolean;
  alignmentEnabled: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [steps, setSteps] = useState<Step[]>([]);
  const [forceAlign, setForceAlign] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [note, setNote] = useState("");
  // Elapsed-seconds ticker for the active long-running step.
  const [, setTick] = useState(0);
  const stepStartRef = useRef(0);

  useEffect(() => {
    if (phase.step !== "working") return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [phase.step]);

  const setStep = (id: StepId, state: StepState, detail = "") => {
    if (state === "active") stepStartRef.current = Date.now();
    setSteps((all) => all.map((s) => (s.id === id ? { ...s, state, detail } : s)));
  };
  const elapsed = () => `${Math.round((Date.now() - stepStartRef.current) / 1000)}s`;

  const acceptFile = async (file: File) => {
    setNote("");
    setPhase({ step: "idle" });
    setSteps([]);
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
    setPhase({ step: "working" });
    setSteps([
      { id: "upload", label: "Upload to private storage", state: "active", detail: "0%" },
      { id: "lyrics", label: "Timed-lyrics lookup", state: "pending", detail: "" },
      { id: "separate", label: "Stem separation (Demucs)", state: "pending", detail: "" },
      {
        id: "align",
        label: "Word timing (WhisperX)",
        state: "pending",
        detail: alignmentEnabled ? "" : "not configured",
      },
    ]);
    stepStartRef.current = Date.now();
    try {
      const presign = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: draft.fileName, contentType: draft.contentType }),
      });
      if (!presign.ok) throw new Error(await apiError(presign, "upload not available"));
      const { key, url } = (await presign.json()) as { key: string; url: string };
      // The one cross-origin request in the whole flow. A CORS miss surfaces
      // as an opaque TypeError ("Load failed" on Safari) — translate it.
      const putStatus = await putWithProgress(url, draft.data, draft.contentType, (f) =>
        setStep("upload", "active", `${Math.round(f * 100)}%`),
      ).catch(() => null);
      if (putStatus === null) {
        throw new Error(
          `storage upload blocked — the bucket's CORS rule must allow PUT from ${window.location.origin}`,
        );
      }
      if (putStatus < 200 || putStatus >= 300)
        throw new Error(`storage upload failed (${putStatus})`);
      setStep("upload", "done", `${Math.round(draft.data.byteLength / 1024 / 1024)} MB`);
      setStep("lyrics", "active");

      const start = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          title: draft.title,
          artist: draft.artist || "Unknown artist",
          durationSeconds: Math.round(draft.duration),
          align: forceAlign,
        }),
      });
      if (!start.ok) throw new Error(await apiError(start, "ingest failed to start"));
      let state = (await start.json()) as {
        jobId: string;
        status: string;
        songId?: string;
        error?: string;
        lyrics?: string;
        align?: boolean;
        alignNote?: string;
        separation?: string;
      };
      setStep(
        "lyrics",
        state.lyrics === "synced" ? "done" : "skip",
        LYRIC_RESULT[state.lyrics ?? ""] ?? "",
      );
      if (!state.align) {
        setStep(
          "align",
          "skip",
          state.alignNote
            ? "not configured"
            : state.lyrics === "synced"
              ? "not needed (community lyrics are timed)"
              : "unavailable",
        );
      }
      setStep("separate", state.separation ? "skip" : "active", state.separation ?? "");

      let lastStatus = state.status;
      while (state.status === "separating" || state.status === "aligning") {
        if (state.status !== lastStatus) {
          // separating → aligning transition
          setStep("separate", "done");
          setStep("align", "active");
          lastStatus = state.status;
        }
        setStep(state.status === "separating" ? "separate" : "align", "active", elapsed());
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const poll = await fetch(`/api/ingest/${state.jobId}`);
        if (!poll.ok) throw new Error("lost track of the ingest job");
        state = { ...state, ...((await poll.json()) as Partial<typeof state>) };
      }
      if (state.status !== "done") throw new Error(state.error ?? "ingest failed");
      setSteps((all) =>
        all.map((s) => (s.state === "active" ? { ...s, state: "done", detail: elapsed() } : s)),
      );
      setPhase({ step: "added", songId: state.songId });
      setDraft(null);
      router.refresh(); // the collection list is server-rendered
    } catch (err) {
      setSteps((all) => all.map((s) => (s.state === "active" ? { ...s, state: "fail" } : s)));
      setPhase({ step: "failed", message: err instanceof Error ? err.message : "ingest failed" });
    } finally {
      setBusy(false);
    }
  };

  const STEP_ICON: Record<StepState, string> = {
    pending: "○",
    active: "◌",
    done: "●",
    skip: "–",
    fail: "✕",
  };
  const STEP_COLOR: Record<StepState, string> = {
    pending: "text-white/30",
    active: "text-neon animate-pulse",
    done: "text-neon",
    skip: "text-white/40",
    fail: "text-red-400",
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
            disabled={busy}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-neon/60 disabled:opacity-50"
          />
          <input
            value={draft.artist}
            onChange={(e) => setDraft({ ...draft, artist: e.target.value })}
            placeholder="Artist (needed for the lyrics lookup)"
            disabled={busy}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-neon/60 disabled:opacity-50"
          />
          {libraryEnabled && alignmentEnabled ? (
            <label className="flex items-start gap-2 text-xs text-white/60">
              <input
                type="checkbox"
                checked={forceAlign}
                onChange={(e) => setForceAlign(e.target.checked)}
                disabled={busy}
                className="mt-0.5 accent-[var(--color-neon)]"
              />
              <span>
                <span className="text-white/80">AI word timing (WhisperX)</span> — re-time every
                word from the isolated vocal, even if community lyrics are found. Best karaoke
                sweep; slower and costs a prediction. (Runs automatically when no timed lyrics
                exist.)
              </span>
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {libraryEnabled ? (
              <button
                onClick={() => void addToLibrary()}
                disabled={busy || !draft.title}
                className="flex-1 rounded-lg bg-neon px-3 py-2 text-sm font-medium text-black transition hover:brightness-110 disabled:opacity-40"
              >
                {busy ? "Processing…" : "Add to library"}
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
                setSteps([]);
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

      {steps.length > 0 ? (
        <ul className="space-y-1.5 rounded-xl border border-white/10 p-3">
          {steps.map((s) => (
            <li key={s.id} className="flex items-baseline gap-2 text-xs">
              <span className={`w-4 text-center ${STEP_COLOR[s.state]}`}>{STEP_ICON[s.state]}</span>
              <span className={s.state === "pending" ? "text-white/30" : "text-white/80"}>
                {s.label}
              </span>
              <span className="min-w-0 flex-1 truncate text-right text-white/40">{s.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {phase.step === "added" && phase.songId ? <IngestPreview songId={phase.songId} /> : null}
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
