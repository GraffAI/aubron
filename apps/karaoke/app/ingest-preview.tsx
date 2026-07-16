"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { KaraokeEngine } from "./lib/engine";
import { formatClock, lineIndexAt, parseLrc } from "./lib/lrc";
import type { LyricLine, LyricsStatus } from "./lib/types";

interface Manifest {
  id: string;
  title: string;
  artist: string;
  lrc: string | null;
  lyricsStatus: LyricsStatus;
  lrcSource?: "provider" | "ai";
  hasProvider: boolean;
  hasAi: boolean;
  urls: { vocals?: string; instrumental: string; full?: string };
}

/**
 * The post-ingest preview: the processed stems + the timed lyrics, mounted
 * right in the add-song flow so timing can be judged before leaving the
 * page. Playback starts just before the first lyric line; the fader is the
 * same full ↔ instrumental crossfade as the player, defaulting to the full
 * mix so the real vocal can be compared against the sweep.
 */
export function IngestPreview({ songId }: { songId: string }) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [vocals, setVocals] = useState(1); // preview default: hear the real vocal vs the sweep
  const engineRef = useRef<KaraokeEngine | null>(null);

  useEffect(() => {
    const engine = new KaraokeEngine();
    engineRef.current = engine;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/songs/${songId}/manifest`);
      if (!res.ok) throw new Error(`preview unavailable (${res.status})`);
      const m = (await res.json()) as Manifest;
      const parsed = m.lrc ? parseLrc(m.lrc) : [];
      await engine.loadFromUrls(m.urls);
      if (cancelled) return;
      engine.setStemGain("vocals", 1);
      setManifest(m);
      setLines(parsed);
      setReady(true);
    })().catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "preview failed");
    });
    return () => {
      cancelled = true;
      engine.dispose();
      engineRef.current = null;
    };
  }, [songId]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const engine = engineRef.current;
      if (engine) {
        setTime(engine.time);
        setPlaying(engine.playing);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const toggle = async () => {
    const engine = engineRef.current;
    if (!engine || !ready) return;
    if (engine.playing) {
      engine.pause();
    } else {
      // Land a couple of seconds before the singing starts.
      if (engine.time === 0 && lines.length > 0) {
        await engine.seek(Math.max(0, lines[0]!.time - 2));
      }
      await engine.play();
    }
  };

  /** Swap active timing (provider ↔ AI) server-side; audio keeps playing. */
  const switchSource = async (source: "provider" | "ai") => {
    if (!manifest || manifest.lrcSource === source) return;
    const res = await fetch(`/api/songs/${songId}/lyrics/source`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source }),
    });
    if (!res.ok) return;
    const fresh = await fetch(`/api/songs/${songId}/manifest`);
    if (!fresh.ok) return;
    const m = (await fresh.json()) as Manifest;
    setManifest(m);
    setLines(m.lrc ? parseLrc(m.lrc) : []);
  };

  if (error) return <p className="text-xs text-red-400">{error}</p>;

  const current = lineIndexAt(lines, time);
  const line = current >= 0 ? lines[current] : null;
  const next = lines[current + 1];

  return (
    <div className="space-y-3 rounded-xl border border-neon/25 bg-neon/5 p-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => void toggle()}
          disabled={!ready}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-neon text-black transition hover:brightness-110 disabled:opacity-40"
          aria-label={playing ? "Pause preview" : "Play preview"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">Preview: {manifest?.title ?? "loading…"}</p>
          <p className="text-xs text-white/40">
            {ready
              ? lines.length > 0
                ? `${formatClock(time)} · starts at the first line`
                : "no timed lyrics — audio only"
              : "decoding stems…"}
          </p>
        </div>
        <Link href={`/sing/${songId}`} className="shrink-0 text-xs text-neon underline">
          Open in player →
        </Link>
      </div>

      {lines.length > 0 ? (
        <div className="min-h-16 space-y-1 text-center">
          <p className="font-display text-lg leading-tight">
            {line?.words ? (
              line.words.map((word, wi) => (
                <span key={wi} className={time >= word.time ? "text-neon" : "text-white/80"}>
                  {word.text}{" "}
                </span>
              ))
            ) : (
              <span className={line ? "text-neon" : "text-white/30"}>
                {line?.text ?? "…waiting for the first line"}
              </span>
            )}
          </p>
          {next ? <p className="truncate text-sm text-white/30">{next.text}</p> : null}
        </div>
      ) : null}

      {manifest?.hasProvider && manifest.hasAi ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-white/50">Timing:</span>
          {(["ai", "provider"] as const).map((source) => (
            <button
              key={source}
              onClick={() => void switchSource(source)}
              className={`rounded-full border px-2.5 py-1 transition ${
                manifest.lrcSource === source
                  ? "border-neon bg-neon/15 text-neon"
                  : "border-white/15 text-white/50 hover:text-white"
              }`}
            >
              {source === "ai" ? "AI timing" : "Provider timing"}
            </button>
          ))}
          <span className="text-white/30">— compare, keep whichever sounds right</span>
        </div>
      ) : null}

      <label className="flex items-center gap-3 text-xs">
        <span className="w-24 shrink-0 text-white/60">Guide vocals</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={vocals}
          onChange={(e) => {
            const v = Number(e.target.value);
            setVocals(v);
            engineRef.current?.setStemGain("vocals", v);
          }}
          className="flex-1 accent-[var(--color-neon)]"
        />
      </label>
    </div>
  );
}
