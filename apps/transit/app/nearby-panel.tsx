"use client";

// What's catchable from where the rider is standing. In the overview it lists the
// routes with a stop within a walk, nearest first; once a line is picked it turns
// into that line's closest stops, so the next tap is a live board rather than a
// hunt across the map.

import { useState } from "react";

import { formatWalk } from "./lib/geo";
import type { NearbyRoute } from "./lib/nearby";
import { colorFor, LINE_COLORS, type RGBA } from "./lib/theme";
import type { RouteInfo, SelectedLine, StopInfo } from "./lib/transit";

const rgba = ([r, g, b, a]: RGBA) => `rgba(${r},${g},${b},${(a ?? 255) / 255})`;
// Same language as the line selector: buses share the uniform bus gray, rail
// carries its brand color.
const colorOf = (r: RouteInfo): RGBA =>
  r.mode === "bus" ? LINE_COLORS.bus! : colorFor(r.shortName, r.color);

const badgeText = (r: RouteInfo): string => r.shortName.replace(/\s*Line$/, "");
const routeLabel = (r: RouteInfo): string => r.longName || r.shortName;

const MAX_ROUTES = 8;

interface Props {
  /** Nearest-first routes with a stop in range (overview mode). */
  routes: NearbyRoute[];
  /** The drilled-into line, if any — switches the panel to its closest stops. */
  line: SelectedLine | null;
  /** Closest stops on that line, nearest first. */
  lineStops: { stop: StopInfo; distanceMeters: number }[];
  loading: boolean;
  /** True while the fix is degraded — the list is last-known, not live. */
  stale: boolean;
  onSelectRoute: (routeId: string) => void;
  onSelectStop: (stop: StopInfo) => void;
  onDisable: () => void;
}

export function NearbyPanel({
  routes,
  line,
  lineStops,
  loading,
  stale,
  onSelectRoute,
  onSelectStop,
  onDisable,
}: Props) {
  // Phones open to just the header strip so the list can't sit under the filter
  // drawer; ≥sm the list is always out (it has the whole left rail to itself).
  const [open, setOpen] = useState(false);

  const shown = routes.slice(0, MAX_ROUTES);
  const count = line ? lineStops.length : shown.length;
  const dot = stale ? "rgb(250,204,21)" : "rgb(103,232,249)";

  return (
    <div className="pointer-events-auto w-fit max-w-[80vw] overflow-hidden rounded-lg border border-white/10 bg-black/55 backdrop-blur-md sm:w-[260px]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: dot, boxShadow: `0 0 6px ${dot}` }}
          />
          <span className="truncate text-[10px] uppercase tracking-[0.24em] text-white/55">
            {line ? "Closest stops" : "Near you"}
          </span>
          {count > 0 && (
            <span className="shrink-0 tabular-nums text-[10px] text-white/30">{count}</span>
          )}
          <span className="shrink-0 text-[10px] text-white/30 sm:hidden">{open ? "▴" : "▾"}</span>
        </button>
        <button
          type="button"
          onClick={onDisable}
          title="Turn location off"
          aria-label="Turn location off"
          className="-mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] text-white/35 transition hover:bg-white/10 hover:text-white/80"
        >
          ✕
        </button>
      </div>

      <div
        className={`${open ? "block" : "hidden"} max-h-[34dvh] overflow-y-auto border-t border-white/10 p-1.5 sm:block sm:max-h-[46vh]`}
      >
        {line ? (
          lineStops.length === 0 ? (
            <Quiet>No stops on this line nearby.</Quiet>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {lineStops.map((s, i) => (
                <li key={s.stop.id}>
                  <button
                    type="button"
                    onClick={() => onSelectStop(s.stop)}
                    className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition hover:bg-white/[0.07] ${
                      i === 0 ? "bg-white/[0.06]" : ""
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-white/85">
                        {s.stop.name}
                      </span>
                      {i === 0 && (
                        <span className="block text-[9px] uppercase tracking-[0.24em] text-cyan-300/50">
                          closest
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-[10px] tabular-nums text-white/45">
                      {formatWalk(s.distanceMeters)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : loading && shown.length === 0 ? (
          <Skeleton />
        ) : shown.length === 0 ? (
          <Quiet>No Sound Transit stops within a 10-minute walk.</Quiet>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {shown.map((n) => {
              const css = rgba(colorOf(n.route));
              const rail = n.route.mode !== "bus";
              return (
                <li key={n.route.id}>
                  <button
                    type="button"
                    onClick={() => onSelectRoute(n.route.id)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition hover:bg-white/[0.07]"
                  >
                    <span
                      className="grid h-6 min-w-[1.75rem] shrink-0 place-items-center rounded px-1 text-[11px] font-bold tabular-nums text-black"
                      style={{
                        background: css,
                        boxShadow: rail ? `0 0 10px ${css}55` : "none",
                        opacity: rail ? 1 : 0.75,
                      }}
                    >
                      {badgeText(n.route)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[12.5px] ${rail ? "text-white/90" : "text-white/75"}`}
                      >
                        {routeLabel(n.route)}
                      </span>
                      <span className="block truncate text-[10px] text-white/35">
                        {n.nearestStop.name}
                      </span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-[10px] tabular-nums text-white/45">
                      {formatWalk(n.distanceMeters)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-3 text-[11px] leading-snug text-white/30">{children}</div>;
}

function Skeleton() {
  return (
    <div className="flex flex-col gap-1 px-2 py-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-2.5">
          <span className="h-6 w-7 shrink-0 animate-pulse rounded bg-white/[0.07]" />
          <span className="h-2.5 flex-1 animate-pulse rounded bg-white/[0.05]" />
        </div>
      ))}
    </div>
  );
}
