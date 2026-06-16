"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { LINE_COLORS, type RGBA } from "./lib/theme";
import type { Vehicle } from "./lib/transit";

// deck.gl needs WebGL + window, so it must never render on the server.
const TransitDeck = dynamic(() => import("./deck").then((m) => m.TransitDeck), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center text-white/30">…</div>,
});

const rgba = ([r, g, b, a]: RGBA) => `rgba(${r},${g},${b},${(a ?? 255) / 255})`;

// Rail lines in display order (with their colors), for the legend.
const LINES: { name: string; color: RGBA }[] = [
  { name: "1 Line", color: LINE_COLORS["1 Line"]! },
  { name: "2 Line", color: LINE_COLORS["2 Line"]! },
  { name: "T Line", color: LINE_COLORS["T Line"]! },
  { name: "N Line", color: LINE_COLORS["N Line"]! },
  { name: "S Line", color: LINE_COLORS["S Line"]! },
];

export function MapStage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selected, setSelected] = useState<Vehicle | null>(null);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of vehicles) m.set(v.shortName, (m.get(v.shortName) ?? 0) + 1);
    return m;
  }, [vehicles]);

  return (
    <main className="fixed inset-0 overflow-hidden">
      <TransitDeck onVehicles={setVehicles} onSelect={setSelected} />

      {/* top-left: title */}
      <div className="pointer-events-none absolute left-5 top-5 select-none">
        <div className="text-[11px] font-medium uppercase tracking-[0.32em] text-white/70">
          Puget Sound
        </div>
        <div className="mt-0.5 text-[10px] uppercase tracking-[0.28em] text-cyan-300/50">
          transit · live
        </div>
      </div>

      {/* top-right: legend + live counts */}
      <div className="pointer-events-none absolute right-5 top-5 select-none text-right">
        <div className="mb-2 text-[10px] uppercase tracking-[0.28em] text-white/40">
          {vehicles.length} vehicles live
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {LINES.map((l) => {
            const n = counts.get(l.name) ?? 0;
            return (
              <div
                key={l.name}
                className="flex items-center gap-2 text-[11px] tabular-nums"
                style={{ opacity: n ? 1 : 0.35 }}
              >
                <span className="text-white/70">{l.name}</span>
                <span className="w-4 text-white/40">{n}</span>
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: rgba(l.color), boxShadow: `0 0 6px ${rgba(l.color)}` }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {selected && <SelectionChip v={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}

function SelectionChip({ v, onClose }: { v: Vehicle; onClose: () => void }) {
  const color = LINE_COLORS[v.shortName] ?? ([150, 170, 190, 220] as RGBA);
  const dev = Math.round(v.deviation / 60);
  const status =
    Math.abs(v.deviation) < 60 ? "on time" : dev > 0 ? `${dev} min late` : `${-dev} min early`;

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-full border border-white/10 bg-black/60 py-2 pl-3 pr-2 text-sm backdrop-blur">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ background: rgba(color), boxShadow: `0 0 8px ${rgba(color)}` }}
        />
        <span className="font-medium text-white/90">{v.shortName}</span>
        <span className="max-w-[40vw] truncate text-white/55">{v.headsign}</span>
        <span className="text-white/35">·</span>
        <span className={Math.abs(v.deviation) < 60 ? "text-emerald-300/80" : "text-amber-300/80"}>
          {status}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-1 grid h-6 w-6 place-items-center rounded-full text-white/40 hover:bg-white/10 hover:text-white/80"
          aria-label="Clear selection"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
