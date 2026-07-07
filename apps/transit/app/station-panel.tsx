"use client";

// The station board. Clicking a stop opens this: the station name and the next
// arrivals, each shown the way a real departure board would — a colored line
// badge, the destination, and a big split-flap status (ARRIVED / ARRIVING /
// DELAYED / "5 MIN"). The signage is the point.

import { colorFor, type RGBA } from "./lib/theme";
import { arrivalState, type StopArrival, type StopBoard } from "./lib/transit";
import { SplitFlap } from "./split-flap";

const rgba = ([r, g, b, a]: RGBA) => `rgba(${r},${g},${b},${(a ?? 255) / 255})`;

// Late by more than this reads as "delayed" on the board, regardless of ETA.
const DELAY_SEC = 180;

interface Signage {
  text: string;
  /** Fixed flap width so the board doesn't reflow as words change. */
  width: number;
  color: string;
  /** A soft pulse for the imminent ones, like a board you should hurry for. */
  pulse?: boolean;
}

function signage(a: StopArrival): Signage {
  if (a.deviation > DELAY_SEC && a.minutesAway > 0) {
    return { text: "DELAYED", width: 8, color: "rgb(248,113,113)", pulse: true };
  }
  const { state, minutes } = arrivalState(a);
  switch (state) {
    case "arrived":
      return { text: "ARRIVED", width: 8, color: "rgb(74,222,128)" };
    case "arriving":
      return { text: "ARRIVING", width: 8, color: "rgb(250,204,21)", pulse: true };
    case "due":
      return { text: "DUE", width: 8, color: "rgb(250,204,21)", pulse: true };
    case "scheduled":
      return { text: `${minutes} MIN`, width: 8, color: "rgb(148,163,184)" };
    default:
      return { text: `${minutes} MIN`, width: 8, color: "rgb(125,211,252)" };
  }
}

export function StationPanel({
  board,
  loading,
  onClose,
  onPick,
}: {
  board: StopBoard | null;
  loading: boolean;
  onClose: () => void;
  /** Frame this arrival's vehicle with the stop. */
  onPick?: (a: StopArrival) => void;
}) {
  return (
    <aside className="absolute bottom-0 left-0 right-0 mx-auto flex max-h-[60dvh] w-full max-w-[560px] flex-col rounded-t-2xl border border-white/10 bg-black/80 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:bottom-5 sm:left-5 sm:right-auto sm:max-h-[78vh] sm:w-[400px] sm:rounded-2xl sm:pb-0">
      <header className="flex items-start gap-3 border-b border-white/10 p-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 text-[9px] uppercase tracking-[0.3em] text-cyan-300/50">
            Station · arrivals
          </div>
          <SplitFlap
            text={board?.name ?? "·········"}
            className="text-[15px] text-amber-200/90"
            cellClassName="h-[22px] w-[13px] text-[15px]"
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-m-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-white/40 hover:bg-white/10 hover:text-white/80"
          aria-label="Close"
        >
          ✕
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!board && loading ? (
          <div className="p-4 text-center text-xs text-white/30">Reading the board…</div>
        ) : board && board.arrivals.length === 0 ? (
          <div className="p-4 text-center text-xs text-white/30">No arrivals in the next hour.</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {board?.arrivals.map((a, i) => {
              const css = rgba(colorFor(a.shortName, a.color));
              const sign = signage(a);
              return (
                <li key={`${a.tripId}-${i}`}>
                  <button
                    type="button"
                    onClick={() => onPick?.(a)}
                    className="flex w-full items-center gap-3 rounded-lg bg-white/[0.03] px-3 py-2.5 text-left transition hover:bg-white/[0.07]"
                  >
                    <span
                      className="grid h-8 min-w-[2rem] shrink-0 place-items-center rounded-md px-1.5 text-[12px] font-bold tabular-nums text-black"
                      style={{ background: css, boxShadow: `0 0 12px ${css}55` }}
                    >
                      {a.shortName.replace(/\s*Line$/, "")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-white/85">
                        {a.headsign || "—"}
                      </span>
                      <span className="block text-[10px] uppercase tracking-[0.18em] text-white/35">
                        {a.predicted ? "live" : "scheduled"}
                        {a.mode === "bus" ? " · bus" : ""}
                      </span>
                    </span>
                    <span style={{ color: sign.color }}>
                      <SplitFlap
                        text={sign.text}
                        width={sign.width}
                        className={sign.pulse ? "animate-pulse" : ""}
                        cellClassName="h-[20px] w-[11px] text-[13px] font-semibold"
                      />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
