"use client";

// Replay: re-run a recorded slice of the live feed through the exact rendering
// path the live map uses. A recording is the /api/vehicles payload sampled every
// ~10s (see scripts/record-replay.ts); playback feeds each frame into the same
// tripId-keyed smoothing, so trains glide the rails exactly as they did live —
// with the debug overlay available to dissect the interpolation over known data.

import { useEffect, useMemo, useRef, useState } from "react";

import type { Vehicle } from "./transit";

export interface ReplayFrame {
  /** Wall time of the sample, epoch ms. */
  t: number;
  vehicles: Vehicle[];
}

export interface ReplayData {
  /** Human label for the recording (e.g. "Mon Jul 6, 4-5pm"). */
  label: string;
  start: number;
  end: number;
  frames: ReplayFrame[];
}

export const REPLAY_SPEEDS = [1, 5, 15, 60] as const;

/** The recording clock + transport state the replay bar drives. */
export interface ReplayState {
  data: ReplayData | null;
  error: string | null;
  /** Current position of the recording clock, epoch ms (0 until loaded). */
  clock: number;
  playing: boolean;
  speed: number;
  vehicles: Vehicle[];
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  seek: (t: number) => void;
}

// Recordings ship gzipped (a half-hour of trains is ~3MB raw, ~10× smaller
// compressed); browsers can inflate natively via DecompressionStream.
async function fetchReplay(name: string): Promise<ReplayData> {
  const res = await fetch(`/replay/${name}.json.gz`);
  if (!res.ok || !res.body) throw new Error(`replay ${name} → ${res.status}`);
  const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
  const data = (await new Response(stream).json()) as ReplayData;
  if (!Array.isArray(data.frames) || data.frames.length === 0) {
    throw new Error("empty recording");
  }
  return data;
}

/** Index of the latest frame at or before `t` (−1 before the first). */
export function frameIndexAt(frames: { t: number }[], t: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]!.t <= t) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

// Advance the recording clock in small wall steps so the scrubber sweeps
// smoothly; frame lookups are memoized on the frame index, not the clock.
const TICK_MS = 250;

/**
 * Load `/replay/<name>.json.gz` and own its transport: play/pause, speed,
 * seeking, and the current frame's vehicles (with gpsAgeSec re-aged against the
 * recording clock, so stale-fading behaves as it did live). Loops at the end.
 */
export function useReplay(name: string | null): ReplayState | null {
  const [data, setData] = useState<ReplayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<number>(15);
  const [clock, setClock] = useState(0);
  const dataRef = useRef<ReplayData | null>(null);

  useEffect(() => {
    if (!name) return;
    let active = true;
    fetchReplay(name)
      .then((d) => {
        if (!active) return;
        dataRef.current = d;
        setData(d);
        setClock(d.frames[0]!.t);
      })
      .catch((err: unknown) => active && setError(String(err)));
    return () => {
      active = false;
    };
  }, [name]);

  useEffect(() => {
    if (!name || !data || !playing) return;
    const id = setInterval(() => {
      setClock((c) => {
        const next = c + TICK_MS * speed;
        // Loop: run off the end → back to the top (the ambient-theater default).
        return next > data.end ? data.frames[0]!.t : next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [name, data, playing, speed]);

  const idx = data ? frameIndexAt(data.frames, clock) : -1;
  const vehicles = useMemo(() => {
    if (!data || idx < 0) return [];
    const frame = data.frames[idx]!;
    // Re-age each fix against the recording clock so staleness reads true.
    return frame.vehicles.map((v) =>
      v.fixTime != null
        ? { ...v, gpsAgeSec: Math.max(0, Math.round((frame.t - v.fixTime) / 1000)) }
        : v,
    );
  }, [data, idx]);

  if (!name) return null;
  return { data, error, clock, playing, speed, vehicles, setPlaying, setSpeed, seek: setClock };
}
