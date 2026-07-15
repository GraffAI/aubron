"use client";

import { useEffect, useRef } from "react";

import { lineIndexAt } from "./lib/lrc";
import type { LyricLine } from "./lib/types";

/**
 * The modern lyric display: an auto-scrolling column with the current line in
 * focus and, when word timings exist, a per-word sweep.
 */
export function LyricsView({ lines, time }: { lines: LyricLine[]; time: number }) {
  const current = lineIndexAt(lines, time);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-line="${current}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [current]);

  if (lines.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-white/30">
        No timed lyrics for this song — instrumental it is.
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      className="h-full overflow-hidden text-center [mask-image:linear-gradient(transparent,black_25%,black_75%,transparent)]"
    >
      {/* Spacers (not padding): border-box padding would floor the box height
          above its flex slot and spill over the mixer below. */}
      <div className="h-[38vh]" />
      {lines.map((line, i) => {
        const isCurrent = i === current;
        return (
          <p
            key={i}
            data-line={i}
            className={`px-4 py-3 font-display text-3xl leading-tight transition-all duration-300 md:text-5xl ${
              isCurrent ? "scale-100 text-white" : "scale-90 text-white/25"
            }`}
          >
            {line.words ? (
              line.words.map((word, wi) => (
                <span
                  key={wi}
                  className={`transition-colors duration-150 ${
                    isCurrent && time >= word.time
                      ? "text-neon drop-shadow-[0_0_18px_rgba(94,234,212,0.45)]"
                      : ""
                  }`}
                >
                  {word.text}{" "}
                </span>
              ))
            ) : (
              <span className={isCurrent ? "text-neon" : ""}>{line.text}</span>
            )}
          </p>
        );
      })}
      <div className="h-[38vh]" />
    </div>
  );
}
