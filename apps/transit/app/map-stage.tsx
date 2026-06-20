"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LINE_COLORS, type RGBA } from "./lib/theme";
import type { Filter, Vehicle } from "./lib/transit";
import { TripPanel } from "./trip-panel";

// deck.gl needs WebGL + window, so it must never render on the server.
const TransitDeck = dynamic(() => import("./deck").then((m) => m.TransitDeck), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center text-white/30">…</div>,
});

const rgba = ([r, g, b, a]: RGBA) => `rgba(${r},${g},${b},${(a ?? 255) / 255})`;

const LINES: { name: string; color: RGBA }[] = [
  { name: "1 Line", color: LINE_COLORS["1 Line"]! },
  { name: "2 Line", color: LINE_COLORS["2 Line"]! },
  { name: "T Line", color: LINE_COLORS["T Line"]! },
];
const ALL_LINES = new Set(LINES.map((l) => l.name));

export function MapStage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [busCount, setBusCount] = useState(0);
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [filter, setFilter] = useState<Filter>({
    lines: new Set(ALL_LINES),
    buses: false,
    onTimeOnly: false,
    debug: false,
  });
  const deepLinked = useRef(false);

  useEffect(() => {
    if (vehicles.length === 0) return;
    if (!deepLinked.current) {
      deepLinked.current = true;
      const want = new URLSearchParams(window.location.search).get("trip");
      const v = want ? vehicles.find((x) => x.tripId === want) : undefined;
      if (v) {
        setSelected(v);
        return;
      }
    }
    setSelected((cur) => (cur ? (vehicles.find((x) => x.tripId === cur.tripId) ?? cur) : cur));
  }, [vehicles]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of vehicles) m.set(v.shortName, (m.get(v.shortName) ?? 0) + 1);
    return m;
  }, [vehicles]);

  const toggleLine = (name: string) =>
    setFilter((f) => {
      const lines = new Set(f.lines);
      if (lines.has(name)) lines.delete(name);
      else lines.add(name);
      return { ...f, lines };
    });

  const handleBuses = useCallback((b: Vehicle[]) => setBusCount(b.length), []);

  return (
    <main className="fixed inset-0 overflow-hidden">
      <TransitDeck
        filter={filter}
        onVehicles={setVehicles}
        onBuses={handleBuses}
        onSelect={setSelected}
      />

      <div className="pointer-events-none absolute left-5 top-5 select-none">
        <div className="text-[11px] font-medium uppercase tracking-[0.32em] text-white/70">
          Puget Sound
        </div>
        <div className="mt-0.5 text-[10px] uppercase tracking-[0.28em] text-cyan-300/50">
          transit · live
        </div>
      </div>

      {/* top-right: interactive filters */}
      <div className="absolute right-5 top-5 select-none text-right">
        <div className="mb-2 text-[10px] uppercase tracking-[0.28em] text-white/40">
          {vehicles.length} trains{filter.buses ? ` · ${busCount} buses` : ""} live
        </div>
        <div className="flex flex-col items-end gap-1">
          {LINES.map((l) => {
            const on = filter.lines.has(l.name);
            const n = counts.get(l.name) ?? 0;
            return (
              <button
                key={l.name}
                type="button"
                onClick={() => toggleLine(l.name)}
                className="flex items-center gap-2 rounded px-1 py-0.5 text-[11px] tabular-nums transition hover:bg-white/5"
                style={{ opacity: on ? 1 : 0.3 }}
              >
                <span className="text-white/70">{l.name}</span>
                <span className="w-4 text-white/40">{n}</span>
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    background: rgba(l.color),
                    boxShadow: on ? `0 0 6px ${rgba(l.color)}` : "none",
                  }}
                />
              </button>
            );
          })}

          <div className="my-1 h-px w-full bg-white/10" />

          <Toggle
            label="Buses"
            on={filter.buses}
            onClick={() => setFilter((f) => ({ ...f, buses: !f.buses }))}
            dot={rgba(LINE_COLORS.bus!)}
          />
          <Toggle
            label="On time only"
            on={filter.onTimeOnly}
            onClick={() => setFilter((f) => ({ ...f, onTimeOnly: !f.onTimeOnly }))}
            dot="rgb(110,231,183)"
          />
          <Toggle
            label="Debug interp"
            on={filter.debug}
            onClick={() => setFilter((f) => ({ ...f, debug: !f.debug }))}
            dot="rgb(90,220,255)"
          />
        </div>
        {filter.buses && (
          <div className="mt-1 max-w-[180px] text-right text-[9px] leading-tight text-white/30">
            buses shown for the visible area
          </div>
        )}
      </div>

      {filter.debug && <DebugLegend />}

      {selected && <TripPanel vehicle={selected} onClose={() => setSelected(null)} />}
    </main>
  );
}

const DEBUG_KEYS: { label: string; dot: string }[] = [
  { label: "raw GPS fix (+ age ring · age · speed)", dot: "rgb(255,64,170)" },
  { label: "snapped to track", dot: "rgb(255,176,32)" },
  { label: "drawn (interpolated)", dot: "rgb(90,220,255)" },
  { label: "prediction target", dot: "rgb(80,240,140)" },
];

function DebugLegend() {
  return (
    <div className="pointer-events-none absolute bottom-5 left-5 select-none rounded-md border border-white/10 bg-black/40 px-3 py-2 backdrop-blur-sm">
      <div className="mb-1 text-[9px] uppercase tracking-[0.28em] text-white/40">interpolation</div>
      <div className="flex flex-col gap-1">
        {DEBUG_KEYS.map((k) => (
          <div key={k.label} className="flex items-center gap-2 text-[10px] text-white/70">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: k.dot }} />
            <span>{k.label}</span>
          </div>
        ))}
        <div className="mt-0.5 flex items-center gap-2 text-[10px] text-white/50">
          <span className="inline-block h-px w-3" style={{ background: "rgb(255,176,32)" }} />
          <span>fix → snap → target</span>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  label,
  on,
  onClick,
  dot,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  dot: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded px-1 py-0.5 text-[11px] transition hover:bg-white/5"
      style={{ opacity: on ? 1 : 0.4 }}
    >
      <span className="text-white/70">{label}</span>
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{
          background: dot,
          boxShadow: on ? `0 0 6px ${dot}` : "none",
          opacity: on ? 1 : 0.5,
        }}
      />
    </button>
  );
}
