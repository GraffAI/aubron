"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { IngestPreview } from "./ingest-preview";
import { readId3 } from "./lib/id3";
import { addLocalSong } from "./lib/local-session";
import { LyricCandidatePreview } from "./lyric-candidate-preview";

interface Draft {
  title: string;
  artist: string;
  duration: number;
  data: ArrayBuffer;
  fileName: string;
  contentType: string;
}

interface LyricCandidate {
  id: string;
  source: string;
  artist: string;
  title: string;
  album: string;
  duration: number;
  timed: boolean;
  wordTimed: boolean;
  synced: string | null;
  plain: string | null;
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
  synced: "timed sheet selected ✓",
  "plain-only": "untimed sheet selected — AI will time it",
  "not-found": "no sheet — AI transcription",
  error: "lyric provider unreachable",
};

/**
 * The ingest flow: drop a lawfully acquired MP3 → pick a lyric sheet from
 * provider candidates (auditioning each against the raw upload, right in the
 * browser) → choose whether AI retimes the chosen sheet → staged progress →
 * in-flow preview with a provider ↔ AI timing toggle. Or skip all of it and
 * sing session-locally: the audio never leaves the tab.
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
  const [candidates, setCandidates] = useState<LyricCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<string>("none");
  const [auditionId, setAuditionId] = useState<string | null>(null);
  const [forceAlign, setForceAlign] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [note, setNote] = useState("");
  // Elapsed-seconds ticker for the active long-running step. Each step's
  // start time is recorded ONCE, on first activation.
  const [, setTick] = useState(0);
  const stepStartsRef = useRef<Partial<Record<StepId, number>>>({});

  useEffect(() => {
    if (phase.step !== "working") return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [phase.step]);

  const setStep = (id: StepId, state: StepState, detail = "") => {
    if (state === "active") stepStartsRef.current[id] ??= Date.now();
    setSteps((all) => all.map((s) => (s.id === id ? { ...s, state, detail } : s)));
  };
  const elapsedFor = (id: StepId) => {
    const start = stepStartsRef.current[id];
    return start === undefined ? "" : `${Math.max(0, Math.round((Date.now() - start) / 1000))}s`;
  };

  const reset = () => {
    setDraft(null);
    setPhase({ step: "idle" });
    setSteps([]);
    setCandidates(null);
    setPicked("none");
    setAuditionId(null);
    setForceAlign(false);
  };

  const acceptFile = async (file: File) => {
    setNote("");
    reset();
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

  const searchLyrics = async () => {
    if (!draft) return;
    setSearching(true);
    setAuditionId(null);
    try {
      const params = new URLSearchParams({
        artist: draft.artist || "Unknown artist",
        title: draft.title,
        duration: String(Math.round(draft.duration)),
      });
      const res = await fetch(`/api/lyrics/search?${params}`);
      const body = res.ok
        ? ((await res.json()) as { candidates: LyricCandidate[] })
        : { candidates: [] };
      setCandidates(body.candidates);
      setPicked(body.candidates[0]?.id ?? "none");
    } catch {
      setCandidates([]);
      setPicked("none");
    } finally {
      setSearching(false);
    }
  };

  const pickedCandidate = candidates?.find((c) => c.id === picked) ?? null;
  // No timed sheet chosen → AI timing is the only path to a karaoke sweep.
  const alignForced = picked === "none" || !pickedCandidate?.timed;
  const alignWanted = alignmentEnabled && (alignForced || forceAlign);

  const singNow = async () => {
    if (!draft) return;
    setBusy(true);
    let lrc: string | null = pickedCandidate?.synced ?? null;
    try {
      if (!lrc && draft.artist) {
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
    setAuditionId(null);
    setPhase({ step: "working" });
    setSteps([
      { id: "upload", label: "Upload to private storage", state: "active", detail: "0%" },
      {
        id: "lyrics",
        label: "Lyric sheet",
        state: "done",
        detail: pickedCandidate
          ? LYRIC_RESULT[pickedCandidate.timed ? "synced" : "plain-only"]!
          : LYRIC_RESULT["not-found"]!,
      },
      { id: "separate", label: "Stem separation (Demucs)", state: "pending", detail: "" },
      {
        id: "align",
        label: pickedCandidate
          ? "Word timing (align chosen sheet)"
          : "Word timing (AI transcription)",
        state: "pending",
        detail: alignmentEnabled ? (alignWanted ? "" : "not requested") : "not configured",
      },
    ]);
    stepStartsRef.current = { upload: Date.now() };
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

      const start = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          title: draft.title,
          artist: draft.artist || "Unknown artist",
          durationSeconds: Math.round(draft.duration),
          align: alignWanted,
          chosen: {
            synced: pickedCandidate?.synced ?? null,
            plain: pickedCandidate?.plain ?? null,
            source: pickedCandidate?.source ?? "none",
          },
        }),
      });
      if (!start.ok) throw new Error(await apiError(start, "ingest failed to start"));
      let state = (await start.json()) as {
        jobId: string;
        status: string;
        songId?: string;
        error?: string;
        align?: boolean;
        alignNote?: string;
        separation?: string;
      };
      if (!state.align)
        setStep("align", "skip", state.alignNote ? "not configured" : "not requested");
      setStep("separate", state.separation ? "skip" : "active", state.separation ?? "");

      let lastStatus = state.status;
      while (state.status === "separating" || state.status === "aligning") {
        if (state.status !== lastStatus) {
          // separating → aligning transition
          setStep("separate", "done", elapsedFor("separate"));
          setStep("align", "active");
          lastStatus = state.status;
        }
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const poll = await fetch(`/api/ingest/${state.jobId}`);
        if (!poll.ok) throw new Error("lost track of the ingest job");
        state = { ...state, ...((await poll.json()) as Partial<typeof state>) };
      }
      if (state.status !== "done") throw new Error(state.error ?? "ingest failed");
      setSteps((all) =>
        all.map((s) =>
          s.state === "active" ? { ...s, state: "done", detail: elapsedFor(s.id) } : s,
        ),
      );
      setPhase({ step: "added", songId: state.songId });
      setDraft(null);
      setCandidates(null);
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
            dir="auto"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Title"
            disabled={busy}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-neon/60 disabled:opacity-50"
          />
          <input
            dir="auto"
            value={draft.artist}
            onChange={(e) => setDraft({ ...draft, artist: e.target.value })}
            placeholder="Artist (needed for the lyrics search)"
            disabled={busy}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-neon/60 disabled:opacity-50"
          />

          {libraryEnabled && candidates !== null ? (
            <div className="space-y-2 rounded-xl border border-white/10 p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium uppercase tracking-widest text-white/40">
                  Lyric sheets
                </h3>
                <button
                  onClick={() => void searchLyrics()}
                  disabled={busy || searching}
                  className="text-xs text-neon underline disabled:opacity-40"
                >
                  {searching ? "searching…" : "search again"}
                </button>
              </div>
              {candidates.length === 0 ? (
                <p className="text-xs text-white/40">
                  No sheets found for this artist/title — fix the names and search again, or
                  continue with AI transcription only.
                </p>
              ) : null}
              {candidates.map((c) => (
                <div key={c.id} className="space-y-2">
                  <label className="flex items-baseline gap-2 text-xs">
                    <input
                      type="radio"
                      name="lyric-candidate"
                      checked={picked === c.id}
                      onChange={() => setPicked(c.id)}
                      disabled={busy}
                      className="accent-[var(--color-neon)]"
                    />
                    <span className="min-w-0 flex-1 truncate text-white/80">
                      {c.artist} — {c.title}
                      {c.album ? <span className="text-white/40"> · {c.album}</span> : null}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] uppercase ${
                        c.wordTimed
                          ? "border-neon/40 text-neon"
                          : c.timed
                            ? "border-white/25 text-white/60"
                            : "border-amber-400/40 text-amber-300"
                      }`}
                    >
                      {c.wordTimed ? "word-timed" : c.timed ? "timed" : "untimed"}
                    </span>
                    <span className="shrink-0 text-white/30">{c.source}</span>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        setAuditionId(auditionId === c.id ? null : c.id);
                      }}
                      disabled={busy}
                      className="shrink-0 text-neon underline disabled:opacity-40"
                    >
                      {auditionId === c.id ? "close" : "audition"}
                    </button>
                  </label>
                  {auditionId === c.id ? (
                    <LyricCandidatePreview data={draft.data} synced={c.synced} plain={c.plain} />
                  ) : null}
                </div>
              ))}
              <label className="flex items-center gap-2 text-xs text-white/60">
                <input
                  type="radio"
                  name="lyric-candidate"
                  checked={picked === "none"}
                  onChange={() => setPicked("none")}
                  disabled={busy}
                  className="accent-[var(--color-neon)]"
                />
                No sheet — let AI transcribe the lyrics from the vocal
              </label>

              {alignmentEnabled ? (
                alignForced ? (
                  <p className="text-xs text-white/40">
                    AI word timing will run:{" "}
                    {picked === "none" ? "no sheet chosen" : "the chosen sheet is untimed"}.
                  </p>
                ) : (
                  <label className="flex items-start gap-2 text-xs text-white/60">
                    <input
                      type="checkbox"
                      checked={forceAlign}
                      onChange={(e) => setForceAlign(e.target.checked)}
                      disabled={busy}
                      className="mt-0.5 accent-[var(--color-neon)]"
                    />
                    <span>
                      <span className="text-white/80">Retime this sheet with AI</span> — keeps the
                      chosen words, transplants word-level timing heard from the vocal. You can
                      compare and switch back afterwards.
                    </span>
                  </label>
                )
              ) : (
                <p className="text-xs text-white/40">
                  AI word timing not configured (set ELEVENLABS_API_KEY) — provider timing only.
                </p>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {libraryEnabled && candidates === null ? (
              <button
                onClick={() => void searchLyrics()}
                disabled={busy || searching || !draft.title}
                className="flex-1 rounded-lg bg-neon px-3 py-2 text-sm font-medium text-black transition hover:brightness-110 disabled:opacity-40"
              >
                {searching ? "Searching sheets…" : "Choose lyrics →"}
              </button>
            ) : null}
            {libraryEnabled && candidates !== null ? (
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
              onClick={reset}
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
            ? "Drop a lawfully acquired MP3 here (or click). Pick its lyric sheet, audition it against your file, then add it to the private library — stems separated, words timed."
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
              <span className="min-w-0 flex-1 truncate text-right text-white/40">
                {s.detail || (s.state === "active" ? elapsedFor(s.id) : "")}
              </span>
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
