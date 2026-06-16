"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import { LINE_COLORS, type RGBA } from "./lib/theme";
import type { Vehicle } from "./lib/transit";
import { TripPanel } from "./trip-panel";

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
  const deepLinked = useRef(false);

  useEffect(() => {
    if (vehicles.length === 0) return;
    // ?trip=<id> deep-links straight to a train (shareable), applied once.
    if (!deepLinked.current) {
      deepLinked.current = true;
      const want = new URLSearchParams(window.location.search).get("trip");
      const v = want ? vehicles.find((x) => x.tripId === want) : undefined;
      if (v) {
        setSelected(v);
        return;
      }
    }
    // Keep the open train's live status (position, deviation) fresh each poll.
    setSelected((cur) => (cur ? (vehicles.find((x) => x.tripId === cur.tripId) ?? cur) : cur));
  }, [vehicles]);

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

      {selected && <TripPanel vehicle={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}
