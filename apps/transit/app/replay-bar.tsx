"use client";

// The replay transport: play/pause, speed, a scrubber over the recording, and
// the recording clock — docked bottom-center like a film strip's controls.

import { REPLAY_SPEEDS, type ReplayState } from "./lib/replay";

// The recording is of Puget Sound service — read its clock in Seattle time no
// matter where the viewer is.
const fmtClock = (t: number): string =>
  new Date(t).toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

export function ReplayBar({ replay }: { replay: ReplayState }) {
  const { data, error, clock, playing, speed } = replay;

  return (
    <div className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 w-[520px] max-w-[calc(100vw-2rem)] -translate-x-1/2">
      <div className="rounded-xl border border-white/10 bg-black/70 px-4 py-3 backdrop-blur-xl">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-400" />
            <span className="text-[10px] uppercase tracking-[0.28em] text-amber-300/80">
              Replay
            </span>
            {data && (
              <span className="hidden text-[10px] uppercase tracking-[0.18em] text-white/40 sm:inline">
                {data.label}
              </span>
            )}
          </div>
          <a
            href="?"
            className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-[0.22em] text-cyan-300/70 transition hover:bg-white/5 hover:text-cyan-200"
          >
            ← Live
          </a>
        </div>

        {error ? (
          <div className="py-1 text-center text-xs text-red-300/80">
            Couldn&apos;t load the recording. {error}
          </div>
        ) : !data ? (
          <div className="py-1 text-center text-xs text-white/30">Loading the recording…</div>
        ) : (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => replay.setPlaying(!playing)}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-sm text-white/90 transition hover:bg-white/20"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? "❚❚" : "▶"}
            </button>

            <input
              type="range"
              min={data.start}
              max={data.end}
              step={1000}
              value={Math.min(Math.max(clock, data.start), data.end)}
              onChange={(e) => replay.seek(Number(e.target.value))}
              className="h-1 min-w-0 flex-1 cursor-pointer accent-amber-400"
              aria-label="Scrub the recording"
            />

            <span className="shrink-0 tabular-nums text-[11px] text-white/70">
              {fmtClock(clock)}
            </span>

            <button
              type="button"
              onClick={() => {
                const i = REPLAY_SPEEDS.indexOf(speed as (typeof REPLAY_SPEEDS)[number]);
                replay.setSpeed(REPLAY_SPEEDS[(i + 1) % REPLAY_SPEEDS.length]!);
              }}
              className="w-11 shrink-0 rounded-md bg-white/10 px-1.5 py-1 text-[11px] tabular-nums text-white/80 transition hover:bg-white/20"
              aria-label="Playback speed"
            >
              {speed}×
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
