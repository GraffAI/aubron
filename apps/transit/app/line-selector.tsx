"use client";

// The drill-down's front door: a typeahead that lists the rail lines first, then
// the ST Express buses. Picking one isolates the map to that line and flies to it;
// clearing it ("Everything") drops back to the ambient overview.

import { useEffect, useMemo, useRef, useState } from "react";

import { colorFor, LINE_COLORS, type RGBA } from "./lib/theme";
import type { RouteInfo } from "./lib/transit";

const rgba = ([r, g, b, a]: RGBA) => `rgba(${r},${g},${b},${(a ?? 255) / 255})`;
// Buses stay the uniform bus gray (matching their map markers); rail lines get
// their brand color, falling back to the agency's GTFS route_color.
const colorOf = (r: RouteInfo): RGBA =>
  r.mode === "bus" ? LINE_COLORS.bus! : colorFor(r.shortName, r.color);

const label = (r: RouteInfo): string => {
  // Rail short names already read like "1 Line"; buses are bare numbers.
  if (r.mode === "bus") return r.longName || r.shortName;
  return r.longName && r.longName !== r.shortName ? r.longName : r.shortName;
};

interface Props {
  rail: RouteInfo[];
  buses: RouteInfo[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Live count per route short name, shown as a quiet badge. */
  counts?: Map<string, number>;
}

export function LineSelector({ rail, buses, selectedId, onSelect, counts }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => [...rail, ...buses].find((r) => r.id === selectedId) ?? null,
    [rail, buses, selectedId],
  );

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    // pointerdown covers touch as well as mouse (mousedown arrives late — or not
    // at all — on touch, leaving the dropdown stuck open on phones).
    const onDoc = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const match = (r: RouteInfo) => {
    const t = q.trim().toLowerCase();
    if (!t) return true;
    return `${r.shortName} ${r.longName}`.toLowerCase().includes(t);
  };
  const railHits = rail.filter(match);
  const busHits = buses.filter(match);

  const choose = (id: string | null) => {
    onSelect(id);
    setOpen(false);
    setQ("");
  };

  return (
    <div ref={boxRef} className="pointer-events-auto relative w-[260px] max-w-[80vw]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-white/10 bg-black/55 px-3 py-2 text-left backdrop-blur-md transition hover:border-white/20"
      >
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={
            selected
              ? {
                  background: rgba(colorOf(selected)),
                  boxShadow: `0 0 8px ${rgba(colorOf(selected))}`,
                }
              : { background: "rgba(255,255,255,0.25)" }
          }
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-white/90">
            {selected ? label(selected) : "All lines"}
          </span>
          <span className="block text-[10px] uppercase tracking-[0.24em] text-white/35">
            {selected ? (selected.mode === "bus" ? "ST Express" : "Link · rail") : "overview"}
          </span>
        </span>
        <span className="text-white/30">{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-10 mt-2 overflow-hidden rounded-lg border border-white/10 bg-black/80 backdrop-blur-xl">
          <div className="border-b border-white/10 p-2">
            {/* 16px on touch screens — anything smaller makes iOS zoom the page on focus */}
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search lines…"
              className="w-full rounded-md bg-white/5 px-2.5 py-1.5 text-base text-white/90 placeholder:text-white/30 focus:outline-none sm:text-[13px]"
            />
          </div>
          <div className="max-h-[50dvh] overflow-y-auto py-1">
            <Row
              dot="rgba(255,255,255,0.25)"
              name="Everything"
              sub="ambient overview"
              active={!selectedId}
              onClick={() => choose(null)}
            />
            {railHits.length > 0 && <GroupLabel>Link &amp; Rail</GroupLabel>}
            {railHits.map((r) => (
              <Row
                key={r.id}
                dot={rgba(colorOf(r))}
                name={label(r)}
                sub={r.shortName}
                count={counts?.get(r.shortName)}
                active={r.id === selectedId}
                onClick={() => choose(r.id)}
              />
            ))}
            {busHits.length > 0 && <GroupLabel>ST Express</GroupLabel>}
            {busHits.map((r) => (
              <Row
                key={r.id}
                dot={rgba(colorOf(r))}
                name={label(r)}
                sub={`Route ${r.shortName}`}
                active={r.id === selectedId}
                onClick={() => choose(r.id)}
              />
            ))}
            {railHits.length === 0 && busHits.length === 0 && (
              <div className="px-3 py-4 text-center text-[12px] text-white/30">No lines match.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-2 text-[9px] uppercase tracking-[0.28em] text-white/30">
      {children}
    </div>
  );
}

function Row({
  dot,
  name,
  sub,
  count,
  active,
  onClick,
}: {
  dot: string;
  name: string;
  sub: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition hover:bg-white/5 ${
        active ? "bg-white/10" : ""
      }`}
    >
      <span
        className="inline-block h-2 w-2 shrink-0 rounded-full"
        style={{ background: dot, boxShadow: active ? `0 0 6px ${dot}` : "none" }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-white/85">{name}</span>
        <span className="block truncate text-[10px] text-white/35">{sub}</span>
      </span>
      {typeof count === "number" && count > 0 && (
        <span className="shrink-0 tabular-nums text-[11px] text-white/40">{count}</span>
      )}
    </button>
  );
}
