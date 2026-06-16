"use client";

import { useEffect, useState } from "react";

import { LINE_COLORS, type RGBA } from "./lib/theme";
import type { TripDetail, Vehicle } from "./lib/transit";

const rgba = ([r, g, b, a]: RGBA) => `rgba(${r},${g},${b},${(a ?? 255) / 255})`;
const FALLBACK: RGBA = [150, 170, 190, 220];

const eta = (min: number): string => (min <= 0 ? "due" : `${min} min`);

export function TripPanel({ vehicle, onClose }: { vehicle: Vehicle; onClose: () => void }) {
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const color = LINE_COLORS[vehicle.shortName] ?? FALLBACK;
  const css = rgba(color);

  useEffect(() => {
    let active = true;
    setTrip(null);
    setLoading(true);
    const load = async () => {
      try {
        const r = await fetch(`/api/trip/${encodeURIComponent(vehicle.tripId)}`);
        const j = (await r.json()) as TripDetail;
        if (active && Array.isArray(j.stops)) setTrip(j);
      } catch {
        /* keep last */
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const id = setInterval(() => void load(), 20000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [vehicle.tripId]);

  const dev = Math.round(vehicle.deviation / 60);
  const onTime = Math.abs(vehicle.deviation) < 60;
  const status = onTime ? "on time" : dev > 0 ? `${dev} min late` : `${-dev} min early`;

  return (
    <aside className="absolute right-0 top-0 flex h-full w-[330px] max-w-[86vw] flex-col border-l border-white/10 bg-black/70 backdrop-blur-md">
      <header className="flex items-start gap-3 border-b border-white/10 p-5">
        <span
          className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: css, boxShadow: `0 0 10px ${css}` }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold tracking-tight text-white/90">
            {vehicle.shortName}
          </div>
          <div className="truncate text-xs text-white/55">to {vehicle.headsign}</div>
          <div
            className={`mt-1 text-[11px] ${onTime ? "text-emerald-300/80" : "text-amber-300/80"}`}
          >
            {status}
            {vehicle.predicted ? "" : " · scheduled"}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/40 hover:bg-white/10 hover:text-white/80"
          aria-label="Close"
        >
          ✕
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-3 text-[10px] uppercase tracking-[0.28em] text-white/35">
          Upcoming stops
        </div>
        {!trip && loading ? (
          <div className="text-xs text-white/30">Loading ETAs…</div>
        ) : trip && trip.stops.length === 0 ? (
          <div className="text-xs text-white/30">End of line.</div>
        ) : (
          <ol className="relative">
            {/* vertical rail */}
            <span
              className="absolute bottom-2 left-[3px] top-2 w-px"
              style={{ background: `linear-gradient(${css}, transparent)` }}
            />
            {trip?.stops.map((s) => (
              <li key={s.stopId} className="relative flex items-center gap-3 py-2 pl-5">
                <span
                  className="absolute left-0 h-[7px] w-[7px] rounded-full"
                  style={{
                    background: s.isNext ? css : "#0a0e14",
                    border: `1.5px solid ${css}`,
                    boxShadow: s.isNext ? `0 0 8px ${css}` : "none",
                  }}
                />
                <span
                  className={`min-w-0 flex-1 truncate text-[13px] ${s.isNext ? "text-white" : "text-white/70"}`}
                >
                  {s.name}
                </span>
                <span
                  className={`shrink-0 tabular-nums text-[12px] ${s.minutesAway <= 0 ? "text-emerald-300/90" : "text-white/55"}`}
                >
                  {eta(s.minutesAway)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}
