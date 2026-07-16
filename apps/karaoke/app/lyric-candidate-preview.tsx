"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { formatClock, lineIndexAt, parseLrc } from "./lib/lrc";
import type { LyricLine } from "./lib/types";

/**
 * Pre-ingest lyric audition: plays the uploaded file AS-IS (unstemmed, never
 * leaves the browser) against a candidate sheet, so "is this the right
 * lyrics, roughly in time?" is answered before any processing is paid for.
 * Timed sheets get the live line readout; untimed ones show the opening
 * lines and a note that AI will do the timing.
 */
export function LyricCandidatePreview({
  data,
  synced,
  plain,
}: {
  data: ArrayBuffer;
  synced: string | null;
  plain: string | null;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const lines = useMemo<LyricLine[]>(() => (synced ? parseLrc(synced) : []), [synced]);

  useEffect(() => {
    const url = URL.createObjectURL(new Blob([data]));
    const audio = new Audio(url);
    audioRef.current = audio;
    let raf = 0;
    const tick = () => {
      setTime(audio.currentTime);
      setPlaying(!audio.paused);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      audio.pause();
      audioRef.current = null;
      URL.revokeObjectURL(url);
    };
  }, [data]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (audio.currentTime === 0 && lines.length > 0) {
        audio.currentTime = Math.max(0, lines[0]!.time - 2);
      }
      void audio.play();
    } else {
      audio.pause();
    }
  };

  const current = lineIndexAt(lines, time);
  const line = current >= 0 ? lines[current] : null;
  const next = lines[current + 1];

  return (
    <div className="space-y-2 rounded-lg bg-black/30 p-3">
      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-neon text-sm text-black transition hover:brightness-110"
          aria-label={playing ? "Pause audition" : "Play audition"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <p className="text-xs text-white/40">
          {lines.length > 0
            ? `${formatClock(time)} — your file, this sheet's timing`
            : "untimed sheet — AI word timing will handle it; here are the opening lines"}
        </p>
      </div>
      {lines.length > 0 ? (
        <div className="min-h-12 text-center">
          <p className="font-display leading-tight">
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
          {next ? <p className="truncate text-xs text-white/30">{next.text}</p> : null}
        </div>
      ) : plain ? (
        <p className="max-h-24 overflow-y-auto whitespace-pre-line text-xs text-white/50">
          {plain.split("\n").slice(0, 8).join("\n")}
        </p>
      ) : null}
    </div>
  );
}
