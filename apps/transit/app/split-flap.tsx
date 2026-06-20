"use client";

// A split-flap (Solari) display: each cell rolls forward through the alphabet to
// its target letter, left-to-right, the way the boards at old train stations did.
// Purely cosmetic — the text is always readable; the roll is the delight.

import { useEffect, useRef, useState } from "react";

const CHARSET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789·:'-/.&";
const INDEX = new Map([...CHARSET].map((c, i) => [c, i] as const));

// How fast cells roll, and how much each cell lags the one before it (the cascade).
const STEP_MS = 42;
const STAGGER_MS = 32;

const normalize = (s: string): string =>
  [...s.toUpperCase()].map((c) => (INDEX.has(c) ? c : " ")).join("");

interface Props {
  text: string;
  /** Fixed cell count; pads/truncates so a changing word doesn't reflow. */
  width?: number;
  className?: string;
  /** Per-cell tailwind classes for the tiles. */
  cellClassName?: string;
}

export function SplitFlap({ text, width, className = "", cellClassName = "" }: Props) {
  const target = normalize(text);
  const cells = Math.max(width ?? target.length, 1);
  const padded = target.slice(0, cells).padEnd(cells, " ");

  const displayRef = useRef(" ".repeat(cells));
  const ticksRef = useRef<number[]>(Array(cells).fill(0));
  const [, render] = useState(0);

  useEffect(() => {
    if (displayRef.current.length !== cells) {
      displayRef.current = " ".repeat(cells);
      ticksRef.current = Array(cells).fill(0);
    }
    const start = performance.now();
    const id = setInterval(() => {
      const arr = [...displayRef.current];
      const elapsed = performance.now() - start;
      let done = true;
      for (let i = 0; i < cells; i++) {
        const want = padded[i] ?? " ";
        if (arr[i] === want) continue;
        if (elapsed < i * STAGGER_MS) {
          done = false; // not its turn yet
          continue;
        }
        const next = ((INDEX.get(arr[i]!) ?? 0) + 1) % CHARSET.length;
        arr[i] = CHARSET[next]!;
        ticksRef.current[i] = (ticksRef.current[i] ?? 0) + 1;
        if (arr[i] !== want) done = false;
      }
      displayRef.current = arr.join("");
      render((n) => n + 1);
      if (done) clearInterval(id);
    }, STEP_MS);
    return () => clearInterval(id);
  }, [padded, cells]);

  const chars = [...displayRef.current];
  return (
    <span className={`inline-flex gap-[2px] ${className}`} aria-label={text}>
      {chars.map((ch, i) => (
        <span
          key={i}
          className={`flap-cell grid place-items-center overflow-hidden rounded-[2px] bg-black/55 ${cellClassName}`}
        >
          <span key={ticksRef.current[i]} className="flap-char tabular-nums">
            {ch === " " ? " " : ch}
          </span>
        </span>
      ))}
    </span>
  );
}
