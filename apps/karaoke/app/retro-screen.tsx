"use client";

import { useEffect, useRef } from "react";

import { lineIndexAt } from "./lib/lrc";
import type { LyricLine } from "./lib/types";

/**
 * Retro mode: a loving emulation of a CD+G karaoke machine, downsides
 * included. 300×216 logical pixels upscaled with smoothing off (chunky),
 * a 16-color-era palette, letters that paint in blockily, a highlight wipe
 * quantized to chunky steps that runs slightly ahead of the vocal (every CDG
 * disc did), and the occasional palette glitch frame.
 */

const W = 300;
const H = 216;
const BG = "#101078"; // that navy
const INK = "#f0f0f0";
const SUNG = "#f8d838";
const ACCENT = "#e050d0";

function wrap(text: string, max: number): string[] {
  const words = text.toUpperCase().split(" ");
  const rows: string[] = [];
  let row = "";
  for (const word of words) {
    if (row && (row + " " + word).length > max) {
      rows.push(row);
      row = word;
    } else {
      row = row ? `${row} ${word}` : word;
    }
  }
  if (row) rows.push(row);
  return rows.slice(0, 3);
}

interface DrawState {
  lines: LyricLine[];
  time: number;
  title: string;
  artist: string;
  playing: boolean;
  duration: number;
}

function draw(ctx: CanvasRenderingContext2D, s: DrawState): void {
  // CDG had no smooth motion: quantize the clock to ~6 updates/second.
  const t = Math.floor(s.time * 6) / 6 + 0.08; // and run a touch early, like the discs did
  const glitch = s.playing && Math.floor(s.time * 10) % 149 === 0;
  ctx.fillStyle = glitch ? ACCENT : BG;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const current = lineIndexAt(s.lines, t);

  // Title card until the first line is near.
  const firstLine = s.lines[0];
  if (current < 0 && (!firstLine || t < firstLine.time - 0.5)) {
    ctx.fillStyle = ACCENT;
    ctx.font = "bold 13px monospace";
    for (const [i, row] of wrap(s.title, 26).entries()) ctx.fillText(row, W / 2, 70 + i * 18);
    ctx.fillStyle = INK;
    ctx.font = "bold 10px monospace";
    for (const [i, row] of wrap(s.artist, 32).entries()) ctx.fillText(row, W / 2, 130 + i * 14);
    ctx.fillStyle = SUNG;
    ctx.font = "bold 9px monospace";
    ctx.fillText(s.playing ? "GET READY..." : "PRESS PLAY TO SING", W / 2, 180);
    // Obligatory color bars.
    const bars = ["#d04030", "#f8d838", "#30a848", "#3050d0", ACCENT, INK];
    bars.forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.fillRect(60 + i * 30, 18, 30, 10);
    });
    return;
  }

  const drawLine = (line: LyricLine | undefined, y: number, isCurrent: boolean) => {
    if (!line) return;
    ctx.font = "bold 14px monospace";
    const rows = wrap(line.text, 22);
    // Upcoming lines paint in blockily, a handful of letters per tick.
    const reveal = isCurrent ? 1 : Math.max(0, Math.min(1, (t - (line.time - 4)) / 0.8));
    rows.forEach((row, i) => {
      const rowY = y + i * 20;
      const shown = Math.ceil(row.length * reveal);
      const text = row.slice(0, shown);
      ctx.fillStyle = INK;
      ctx.fillText(text, W / 2, rowY);
    });
    if (!isCurrent) return;
    // Highlight wipe over the current line, quantized to chunky steps.
    const next = s.lines[current + 1];
    const lineEnd = next ? next.time : Math.min(line.time + 6, s.duration);
    let progress: number;
    if (line.words && line.words.length > 0) {
      const sungWords = line.words.filter((w) => w.time <= t).length;
      progress = sungWords / line.words.length;
    } else {
      progress = (t - line.time) / Math.max(0.5, lineEnd - line.time);
    }
    progress = Math.max(0, Math.min(1, Math.floor(progress * 12) / 12));
    ctx.save();
    const total = rows.length;
    const done = progress * total;
    rows.forEach((row, i) => {
      const rowY = y + i * 20;
      const rowProgress = Math.max(0, Math.min(1, done - i));
      if (rowProgress === 0) return;
      const width = ctx.measureText(row).width;
      ctx.beginPath();
      ctx.rect(W / 2 - width / 2 - 2, rowY - 10, (width + 4) * rowProgress, 20);
      ctx.clip();
      ctx.fillStyle = SUNG;
      ctx.fillText(row, W / 2, rowY);
      ctx.restore();
      ctx.save();
    });
    ctx.restore();
  };

  drawLine(s.lines[Math.max(0, current)], 78, current >= 0);
  drawLine(current >= 0 ? s.lines[current + 1] : s.lines[1], 148, false);

  // Progress dots along the bottom, in lieu of anything useful.
  const dots = 20;
  const lit = Math.floor((s.time / Math.max(1, s.duration)) * dots);
  for (let i = 0; i < dots; i++) {
    ctx.fillStyle = i <= lit ? SUNG : "#3838a0";
    ctx.fillRect(30 + i * 12, H - 14, 8, 4);
  }
}

export function RetroScreen(props: DrawState) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    draw(ctx, props);
  });

  return (
    <div className="relative mx-auto flex h-full w-full max-w-4xl items-center justify-center">
      <div className="relative aspect-[25/18] w-full overflow-hidden rounded-lg border-8 border-black bg-black shadow-[0_0_60px_rgba(16,16,120,0.5)]">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="h-full w-full [image-rendering:pixelated]"
        />
        {/* CRT scanlines + vignette, free of charge */}
        <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(0,0,0,0.22)_0px,rgba(0,0,0,0.22)_1px,transparent_1px,transparent_3px)]" />
        <div className="pointer-events-none absolute inset-0 [box-shadow:inset_0_0_80px_rgba(0,0,0,0.55)]" />
      </div>
    </div>
  );
}
