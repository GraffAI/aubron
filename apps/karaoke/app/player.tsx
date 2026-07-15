"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { renderDaisyStems } from "./lib/daisy";
import { KaraokeEngine, type MicChannel } from "./lib/engine";
import { getLocalSong } from "./lib/local-session";
import { formatClock } from "./lib/lrc";
import type { Song } from "./lib/types";
import { LyricsView } from "./lyrics-view";
import { RetroScreen } from "./retro-screen";

type Status = "loading" | "ready" | "error";

export function Player({ song: serverSong, songId }: { song: Song | null; songId: string }) {
  const [song, setSong] = useState<Song | null>(serverSong);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(serverSong?.duration ?? 0);
  const [retro, setRetro] = useState(false);
  const [mixerOpen, setMixerOpen] = useState(true);
  const [gains, setGains] = useState({ vocals: 0.25, instrumental: 1, master: 1 });
  const [mics, setMics] = useState<MicChannel[]>([]);
  const [micLevels, setMicLevels] = useState<Record<number, number>>({});
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micError, setMicError] = useState("");
  const engineRef = useRef<KaraokeEngine | null>(null);

  // Boot the engine and load this song's audio.
  useEffect(() => {
    const engine = new KaraokeEngine();
    engineRef.current = engine;
    let cancelled = false;
    (async () => {
      let resolved = serverSong;
      let localData: ArrayBuffer | undefined;
      if (!resolved) {
        const local = getLocalSong(songId);
        if (!local)
          throw new Error("Song not found — local songs live only in the tab that loaded them.");
        resolved = local.song;
        localData = local.data;
      }
      if (resolved.source.kind === "builtin") {
        const stems = await renderDaisyStems();
        engine.loadBuffers(stems.vocals, stems.instrumental);
      } else if (resolved.source.kind === "stems") {
        await engine.loadFromUrls(resolved.source.urls);
      } else {
        await engine.loadLocalMix(localData!);
      }
      if (cancelled) return;
      setSong(resolved);
      setDuration(engine.duration);
      setStatus("ready");
    })().catch((err: unknown) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : "Failed to load audio.");
        setStatus("error");
      }
    });
    return () => {
      cancelled = true;
      engine.dispose();
      engineRef.current = null;
    };
  }, [serverSong, songId]);

  // The clock: poll engine time + mic meters every frame.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const engine = engineRef.current;
      if (engine) {
        setTime(engine.time);
        setPlaying(engine.playing);
        const levels: Record<number, number> = {};
        for (const mic of engine.listMics()) levels[mic.id] = engine.micLevel(mic.id);
        setMicLevels(levels);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const togglePlay = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || status !== "ready") return;
    if (engine.playing) engine.pause();
    else void engine.play();
  }, [status]);

  // Space bar = play/pause, unless typing in a control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  const setGain = (key: keyof typeof gains, value: number) => {
    setGains((g) => ({ ...g, [key]: value }));
    const engine = engineRef.current;
    if (!engine) return;
    if (key === "master") engine.setMasterGain(value);
    else engine.setStemGain(key, value);
  };

  const addMic = async (deviceId?: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    setMicError("");
    try {
      await engine.addMic(deviceId);
      setMics(engine.listMics());
      // Labels only populate after permission is granted.
      setDevices(await engine.listMicDevices());
    } catch {
      setMicError("Mic unavailable — check browser permissions.");
    }
  };

  if (status === "error") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-white/70">{error}</p>
        <Link href="/" className="text-neon underline">
          Back to the library
        </Link>
      </main>
    );
  }

  const hasVocalStem =
    song?.source.kind === "builtin" ||
    (song?.source.kind === "stems" && song.source.urls.vocals !== undefined);

  return (
    <main className="flex h-dvh flex-col">
      <header className="flex items-center gap-4 border-b border-white/10 px-4 py-3">
        <Link href="/" className="text-white/50 transition hover:text-white">
          ← Library
        </Link>
        <div className="min-w-0 flex-1 text-center">
          <span className="block truncate font-medium">{song?.title ?? "…"}</span>
          <span className="block truncate text-xs text-white/40">{song?.artist}</span>
        </div>
        <button
          onClick={() => setRetro((r) => !r)}
          className={`rounded-full border px-3 py-1 text-xs transition ${
            retro
              ? "border-fuchsia-400 bg-fuchsia-400/20 text-fuchsia-200"
              : "border-white/15 text-white/60 hover:text-white"
          }`}
        >
          {retro ? "CD+G 1992" : "Modern"}
        </button>
      </header>

      <section className="min-h-0 flex-1 overflow-hidden">
        {status === "loading" ? (
          <div className="flex h-full items-center justify-center text-white/40">
            Warming up the band…
          </div>
        ) : retro ? (
          <div className="h-full bg-black p-4">
            <RetroScreen
              lines={song?.lyrics ?? []}
              time={time}
              title={song?.title ?? ""}
              artist={song?.artist ?? ""}
              playing={playing}
              duration={duration}
            />
          </div>
        ) : (
          <LyricsView lines={song?.lyrics ?? []} time={time} />
        )}
      </section>

      {mixerOpen && (
        <section className="grid gap-6 border-t border-white/10 px-6 py-4 md:grid-cols-2">
          <div className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-widest text-white/40">Track</h2>
            <Fader
              label={hasVocalStem ? "Guide vocals" : "Guide vocals (needs separated stems)"}
              value={gains.vocals}
              disabled={!hasVocalStem}
              onChange={(v) => setGain("vocals", v)}
            />
            <Fader
              label="Instrumental"
              value={gains.instrumental}
              onChange={(v) => setGain("instrumental", v)}
            />
            <Fader label="Master" value={gains.master} onChange={(v) => setGain("master", v)} />
          </div>
          <div className="space-y-3">
            <h2 className="text-xs font-medium uppercase tracking-widest text-white/40">
              Microphones {mics.length > 1 ? "· duet!" : ""}
            </h2>
            {mics.map((mic) => (
              <div key={mic.id} className="space-y-2 rounded-xl border border-white/10 p-3">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded bg-white/10">
                    <div
                      className="h-full bg-neon transition-[width] duration-75"
                      style={{ width: `${(micLevels[mic.id] ?? 0) * 100}%` }}
                    />
                  </div>
                  <span className="max-w-40 truncate text-xs text-white/50">{mic.label}</span>
                  <button
                    onClick={() => {
                      engineRef.current?.removeMic(mic.id);
                      setMics(engineRef.current?.listMics() ?? []);
                    }}
                    className="text-white/40 hover:text-red-400"
                    aria-label="Remove mic"
                  >
                    ✕
                  </button>
                </div>
                <Fader
                  label="Level"
                  value={mic.gain}
                  onChange={(v) => {
                    engineRef.current?.setMicGain(mic.id, v);
                    setMics(engineRef.current?.listMics() ?? []);
                  }}
                />
                <Fader
                  label="Echo echo echo"
                  value={mic.echo}
                  onChange={(v) => {
                    engineRef.current?.setMicEcho(mic.id, v);
                    setMics(engineRef.current?.listMics() ?? []);
                  }}
                />
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => void addMic()}
                className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 transition hover:border-neon/60 hover:text-white"
              >
                + Add mic
              </button>
              {devices
                .filter((d) => d.label && !mics.some((m) => m.deviceId === d.deviceId))
                .map((d) => (
                  <button
                    key={d.deviceId}
                    onClick={() => void addMic(d.deviceId)}
                    className="max-w-56 truncate rounded-full border border-white/10 px-3 py-1 text-xs text-white/40 transition hover:text-white"
                  >
                    + {d.label}
                  </button>
                ))}
              {micError ? <span className="text-xs text-red-400">{micError}</span> : null}
            </div>
            <p className="text-[11px] leading-snug text-white/30">
              Use headphones or keep speakers modest — live mics through speakers feed back. Yes,
              you can plug in two mics: every input is its own channel.
            </p>
          </div>
        </section>
      )}

      <footer className="flex items-center gap-4 border-t border-white/10 px-6 py-4">
        <button
          onClick={togglePlay}
          disabled={status !== "ready"}
          className="grid h-12 w-12 place-items-center rounded-full bg-neon text-lg text-black transition hover:brightness-110 disabled:opacity-40"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="w-12 text-right text-xs tabular-nums text-white/50">
          {formatClock(time)}
        </span>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(time, duration)}
          onChange={(e) => void engineRef.current?.seek(Number(e.target.value))}
          className="flex-1 accent-[var(--color-neon)]"
        />
        <span className="w-12 text-xs tabular-nums text-white/50">{formatClock(duration)}</span>
        <button
          onClick={() => setMixerOpen((o) => !o)}
          className={`rounded-full border px-3 py-1 text-xs transition ${
            mixerOpen ? "border-neon/50 text-neon" : "border-white/15 text-white/60"
          }`}
        >
          Mixer
        </button>
      </footer>
    </main>
  );
}

function Fader({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-3 text-xs ${disabled ? "opacity-40" : ""}`}>
      <span className="w-40 shrink-0 text-white/60">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-[var(--color-neon)]"
      />
    </label>
  );
}
