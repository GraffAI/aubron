"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { boundsAround, boundsOfPaths, type Focus, type Padding } from "./lib/camera";
import { nearbyRoutes, nearestStopsOnLine, type NearbyStop } from "./lib/nearby";
import { colorFor, LINE_COLORS, type RGBA } from "./lib/theme";
import {
  framableByDirection,
  type Filter,
  type NetworkData,
  type RouteGeometry,
  type SelectedLine,
  type StopArrival,
  type StopBoard,
  type StopInfo,
  type Vehicle,
} from "./lib/transit";
import { useReplay } from "./lib/replay";
import { useGeolocation, type GeoState } from "./lib/useGeolocation";
import { LineSelector } from "./line-selector";
import { NearbyPanel } from "./nearby-panel";
import { ReplayBar } from "./replay-bar";
import { StationPanel } from "./station-panel";
import { TripPanel } from "./trip-panel";

// deck.gl needs WebGL + window, so it must never render on the server.
const TransitDeck = dynamic(() => import("./deck").then((m) => m.TransitDeck), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center text-white/30">…</div>,
});

const rgba = ([r, g, b, a]: RGBA) => `rgba(${r},${g},${b},${(a ?? 255) / 255})`;

const LINE_POLL_MS = 20_000;
const BOARD_POLL_MS = 20_000;

// A walkable ring around the rider. The hook only publishes a fix once it has
// moved ~25m, so this refetches on real movement; the timer is just a floor under
// a rider standing still while service around them changes.
const NEARBY_RADIUS_M = 800;
const NEARBY_POLL_MS = 45_000;

// Live glides span one poll (~15s); at replay speed they compress to match, so
// a 60× replay doesn't spend a quarter-hour easing into each frame.
const TWEEN_MS = 15_000;
const replayTween = (speed: number): number =>
  Math.max(400, Math.round(TWEEN_MS / Math.max(1, speed)));

// One padding for every station frame — the initial station-only shot and the
// refined shot that adds approaching trains. Keeping it identical means the
// station holds the exact same screen position across both, so the refine reads
// as a smooth zoom-out rather than a pan. Extra room at the bottom clears the
// station panel.
const STATION_PADDING: Padding = { top: 100, bottom: 180, left: 140, right: 140 };

export function MapStage() {
  const [net, setNet] = useState<NetworkData | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [busCount, setBusCount] = useState(0);
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [filter, setFilter] = useState<Filter>({
    lines: new Set<string>(),
    buses: false,
    onTimeOnly: false,
    debug: false,
  });

  // Drill-down state.
  const [lineId, setLineId] = useState<string | null>(null);
  const [line, setLine] = useState<SelectedLine | null>(null);
  const [lineBusVehicles, setLineBusVehicles] = useState<Vehicle[]>([]);
  const [stop, setStop] = useState<StopInfo | null>(null);
  const [board, setBoard] = useState<StopBoard | null>(null);
  const [boardLoading, setBoardLoading] = useState(false);

  const [focus, setFocus] = useState<Focus | null>(null);
  // Mobile: the filter stack collapses behind a status pill (it would collide
  // with the line selector on a phone-width screen).
  const [controlsOpen, setControlsOpen] = useState(false);
  const focusNonce = useRef(0);
  const framedTrip = useRef<string | null>(null);
  const deepLinked = useRef(false);

  // ?replay=<name> (or =1 for the bundled recording) swaps the live feed for a
  // recorded one — same map, same smoothing, historical trains. Drill-down and
  // panels are live-data surfaces, so they sit out during a replay.
  const [replayName, setReplayName] = useState<string | null>(null);
  useEffect(() => {
    const want = new URLSearchParams(window.location.search).get("replay");
    if (!want) return;
    setReplayName(/^[\w-]+$/.test(want) && want !== "1" && want !== "true" ? want : "replay");
  }, []);
  const replay = useReplay(replayName);

  // Location awareness: opt-in, off until the rider taps the locate button — and
  // off wholesale during a replay, which is a historical feed with no "here" in
  // it. The URL is read on mount, well before any fix could land, so the watch
  // never even starts on a replay page.
  const geo = useGeolocation(!replayName);
  const [nearStops, setNearStops] = useState<NearbyStop[]>([]);
  const [nearLoading, setNearLoading] = useState(false);
  const flewToUser = useRef(false);

  const flyTo = useCallback((focusInit: Omit<Focus, "nonce"> | null) => {
    if (!focusInit) return;
    focusNonce.current += 1;
    setFocus({ ...focusInit, nonce: focusNonce.current });
  }, []);

  // Network catalog once: rail lines (drawn ambiently) + ST Express bus catalog.
  useEffect(() => {
    fetch("/api/network")
      .then((r) => r.json())
      .then((n: NetworkData) => {
        setNet(n);
        // Ambient overview starts with every rail line lit.
        setFilter((f) => ({ ...f, lines: new Set(n.routes.map((r) => r.shortName)) }));
      })
      .catch(() => null);
  }, []);

  // Deep-link a trip on first load, then keep the selection's data fresh.
  useEffect(() => {
    if (vehicles.length === 0 || replayName) return;
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
  }, [vehicles, replayName]);

  // Resolve a picked line's geometry (shapes + its own stops) on demand.
  useEffect(() => {
    if (!lineId || !net) {
      setLine(null);
      return;
    }
    let active = true;
    setLine(null);
    const route = [...net.routes, ...net.busRoutes].find((r) => r.id === lineId);
    fetch(`/api/route/${encodeURIComponent(lineId)}`)
      .then((r) => r.json())
      .then((g: RouteGeometry) => {
        if (!active || !Array.isArray(g.shapes)) return;
        setLine({
          routeId: g.routeId,
          shortName: g.shortName,
          mode: route?.mode ?? "bus",
          shapes: g.shapes,
          stops: g.stops,
          color: route?.color,
        });
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, [lineId, net]);

  // Fly to the line once its geometry lands.
  useEffect(() => {
    if (!line) return;
    const b = boundsOfPaths(line.shapes.map((s) => s.path));
    if (b) flyTo({ bounds: b, padding: 110, maxZoom: 13.5 });
  }, [line, flyTo]);

  // Live vehicles for a selected BUS line (rail reuses the network-wide feed).
  useEffect(() => {
    const route = net?.busRoutes.find((r) => r.id === lineId);
    if (!lineId || !route) {
      setLineBusVehicles([]);
      return;
    }
    let active = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/route/${encodeURIComponent(lineId)}/vehicles`);
        const j = (await r.json()) as { vehicles?: Vehicle[] };
        if (active && j.vehicles) setLineBusVehicles(j.vehicles);
      } catch {
        /* keep last */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), LINE_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [lineId, net]);

  // The station board for an opened stop.
  useEffect(() => {
    if (!stop) {
      setBoard(null);
      return;
    }
    let active = true;
    setBoard(null);
    setBoardLoading(true);
    const ids = stop.stopIds?.length
      ? `?ids=${stop.stopIds.map(encodeURIComponent).join(",")}`
      : "";
    const load = async () => {
      try {
        const r = await fetch(`/api/stop/${encodeURIComponent(stop.id)}${ids}`);
        const j = (await r.json()) as StopBoard;
        if (active && Array.isArray(j.arrivals)) setBoard(j);
      } catch {
        /* keep last */
      } finally {
        if (active) setBoardLoading(false);
      }
    };
    void load();
    const id = setInterval(() => void load(), BOARD_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [stop]);

  // When a station opens, center on it; refine to keep an approaching train per
  // direction in shot once the board reports them. Both shots are centered on the
  // station, so the refine only zooms out — no lurch. Don't chase every poll: only
  // re-frame when the chosen set of trains actually changes.
  useEffect(() => {
    if (!stop) {
      framedTrip.current = null;
      return;
    }
    flyTo({
      bounds: boundsAround([stop.lon, stop.lat], []),
      padding: STATION_PADDING,
      maxZoom: 14.5,
    });
  }, [stop, flyTo]);

  useEffect(() => {
    if (!stop || !board) return;
    const incoming = framableByDirection(board.arrivals);
    if (incoming.length === 0) return;
    const signature = incoming.map((a) => a.tripId).join(",");
    if (framedTrip.current === signature) return;
    framedTrip.current = signature;
    const bounds = boundsAround(
      [stop.lon, stop.lat],
      incoming.map((a) => [a.vehicleLon!, a.vehicleLat!] as [number, number]),
    );
    flyTo({ bounds, padding: STATION_PADDING, maxZoom: 14 });
  }, [board, stop, flyTo]);

  // Frame the rider the first time a fix lands (and again on demand from the
  // locate button) — same centered-box framing a station gets.
  const userPosition = geo.position;
  const flyToUser = useCallback(
    (p: { lat: number; lon: number }) =>
      flyTo({ bounds: boundsAround([p.lon, p.lat], []), padding: 90, maxZoom: 14.5 }),
    [flyTo],
  );

  useEffect(() => {
    if (!userPosition || replayName) {
      flewToUser.current = false;
      return;
    }
    if (flewToUser.current) return;
    flewToUser.current = true;
    flyToUser(userPosition);
  }, [userPosition, replayName, flyToUser]);

  // Stops around the rider. A replay is a historical feed, so "near you" has no
  // meaning there — the whole feature sits out.
  useEffect(() => {
    if (!userPosition || replayName) {
      setNearStops([]);
      return;
    }
    let active = true;
    const load = async () => {
      setNearLoading(true);
      try {
        const r = await fetch(
          `/api/nearby?lat=${userPosition.lat}&lon=${userPosition.lon}&radius=${NEARBY_RADIUS_M}`,
        );
        const j = (await r.json()) as { stops?: NearbyStop[] };
        if (active && Array.isArray(j.stops)) setNearStops(j.stops);
      } catch {
        /* keep last */
      } finally {
        if (active) setNearLoading(false);
      }
    };
    void load();
    const id = setInterval(() => void load(), NEARBY_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [userPosition, replayName]);

  // Only routes the app itself can drill into: OBA answers for every agency in
  // range, and a tap on a Metro route would have nowhere to go.
  const knownRoutes = useMemo(
    () => new Map([...(net?.routes ?? []), ...(net?.busRoutes ?? [])].map((r) => [r.id, r])),
    [net],
  );
  const nearRoutes = useMemo(
    () => (userPosition ? nearbyRoutes(nearStops, userPosition, knownRoutes) : []),
    [nearStops, userPosition, knownRoutes],
  );
  const nearOnLine = useMemo(
    () => (line && userPosition ? nearestStopsOnLine(line.stops, userPosition, 3) : []),
    [line, userPosition],
  );

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of vehicles) m.set(v.shortName, (m.get(v.shortName) ?? 0) + 1);
    return m;
  }, [vehicles]);

  const selectLine = (id: string | null) => {
    setStop(null);
    setSelected(null);
    setLineId(id);
    if (!id) {
      setLine(null);
      setLineBusVehicles([]);
      const b = net ? boundsOfPaths(net.shapes.map((s) => s.path)) : null;
      if (b) flyTo({ bounds: b, padding: 80, maxZoom: 11.5 });
    }
  };

  const frameArrival = (a: StopArrival) => {
    if (a.vehicleLon == null || a.vehicleLat == null || !stop) return;
    framedTrip.current = a.tripId;
    const bounds = boundsAround([stop.lon, stop.lat], [[a.vehicleLon, a.vehicleLat]]);
    flyTo({ bounds, padding: STATION_PADDING, maxZoom: 14 });
  };

  const toggleLine = (name: string) =>
    setFilter((f) => {
      const lines = new Set(f.lines);
      if (lines.has(name)) lines.delete(name);
      else lines.add(name);
      return { ...f, lines };
    });

  const handleBuses = useCallback((b: Vehicle[]) => setBusCount(b.length), []);

  // First tap asks the browser; every tap after that re-centers on the rider.
  const locate = () => {
    if (geo.state === "unavailable" || geo.state === "denied") return;
    if (userPosition) flyToUser(userPosition);
    else geo.start();
  };

  const railRoutes = net?.routes ?? [];
  const busRoutes = net?.busRoutes ?? [];
  const liveOnLine = line
    ? line.mode === "bus"
      ? lineBusVehicles.length
      : vehicles.filter((v) => v.routeId === line.routeId).length
    : 0;

  return (
    <main className="fixed inset-0 overflow-hidden">
      <TransitDeck
        net={net}
        filter={filter}
        selectedLine={line}
        lineBusVehicles={lineBusVehicles}
        selectedStopId={stop?.id ?? null}
        userPosition={replayName ? null : userPosition}
        focus={focus}
        replay={
          replay?.data ? { vehicles: replay.vehicles, tweenMs: replayTween(replay.speed) } : null
        }
        onVehicles={setVehicles}
        onBuses={handleBuses}
        onSelect={replay ? undefined : setSelected}
        onSelectStop={replay ? undefined : setStop}
      />

      {/* top-left: wordmark + the line selector (the drill-down's front door) */}
      <div className="absolute left-[max(1.25rem,env(safe-area-inset-left))] top-[max(1.25rem,env(safe-area-inset-top))] flex flex-col gap-3">
        <div className="pointer-events-none select-none">
          <div className="text-[11px] font-medium uppercase tracking-[0.32em] text-white/70">
            Puget Sound
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.28em] text-cyan-300/50">
            transit · live
          </div>
        </div>
        {!replay && (
          <LineSelector
            rail={railRoutes}
            buses={busRoutes}
            selectedId={lineId}
            onSelect={selectLine}
            counts={counts}
          />
        )}
        {line && (
          <div className="pointer-events-none max-w-[260px] text-[10px] uppercase tracking-[0.22em] text-white/40">
            {liveOnLine} live · tap a station for arrivals
          </div>
        )}
        {/* Nearby sits under the selector, and stands down whenever a bottom
            sheet is up — on a phone they'd be fighting for the same screen. */}
        {userPosition && !replay && !stop && !selected && (
          <NearbyPanel
            routes={nearRoutes}
            line={line}
            lineStops={nearOnLine}
            // The catalog gates which routes can be listed at all, so until it
            // lands the list is still loading — not empty.
            loading={nearLoading || !net}
            stale={geo.state === "error"}
            onSelectRoute={selectLine}
            onSelectStop={setStop}
            onDisable={geo.stop}
          />
        )}
      </div>

      {/* top-right: overview filters (ambient view only) or focused toggles.
          On phones the stack folds behind a status pill so it can't collide
          with the selector; ≥sm it's always spread out. */}
      <div className="absolute right-[max(1.25rem,env(safe-area-inset-right))] top-[max(1.25rem,env(safe-area-inset-top))] flex select-none flex-col items-end text-right">
        {/* The locate button rides beside the status pill so it stays reachable
            on a phone without opening the filter drawer. */}
        <div className="mb-2 flex items-center gap-2">
          {!replay && <LocateButton state={geo.state} active={!!userPosition} onClick={locate} />}
          <button
            type="button"
            onClick={() => setControlsOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/55 px-2.5 py-2 backdrop-blur-md sm:hidden"
          >
            <span className="text-[10px] uppercase tracking-[0.2em] text-white/60">
              {!line ? `${vehicles.length}${filter.buses ? `+${busCount}` : ""} live` : "filters"}
            </span>
            <span className="text-[10px] text-white/40">{controlsOpen ? "▴" : "▾"}</span>
          </button>
        </div>
        <div
          className={`${controlsOpen ? "flex" : "hidden"} flex-col items-end rounded-lg border border-white/10 bg-black/55 p-2 text-right backdrop-blur-md sm:flex sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none`}
        >
          {!line ? (
            <>
              <div className="mb-2 hidden text-[10px] uppercase tracking-[0.28em] text-white/40 sm:block">
                {vehicles.length} trains{filter.buses ? ` · ${busCount} buses` : ""} live
              </div>
              <div className="flex flex-col items-end gap-1">
                {railRoutes.map((l) => {
                  const on = filter.lines.has(l.shortName);
                  const n = counts.get(l.shortName) ?? 0;
                  const color = colorFor(l.shortName, l.color);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => toggleLine(l.shortName)}
                      className="flex items-center gap-2 rounded px-1 py-0.5 text-[11px] tabular-nums transition hover:bg-white/5"
                      style={{ opacity: on ? 1 : 0.3 }}
                    >
                      <span className="text-white/70">{l.shortName}</span>
                      <span className="w-4 text-white/40">{n}</span>
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{
                          background: rgba(color),
                          boxShadow: on ? `0 0 6px ${rgba(color)}` : "none",
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
            </>
          ) : (
            <div className="flex flex-col items-end gap-1">
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
          )}
        </div>
      </div>

      {filter.debug && <DebugLegend />}

      {stop && !replay && (
        <StationPanel
          board={board}
          loading={boardLoading}
          onClose={() => setStop(null)}
          onPick={frameArrival}
        />
      )}

      {selected && !replay && <TripPanel vehicle={selected} onClose={() => setSelected(null)} />}

      {replay && <ReplayBar replay={replay} />}
    </main>
  );
}

// Legend for the interpolation debug overlay. The story reads past → present →
// future: a raw fix snaps to the track, the train is dead-reckoned forward
// along a green arc, and the drawn dot eases along it toward the arrowhead.
const DEBUG_KEYS: { label: string; dot: string }[] = [
  { label: "raw GPS fix — ring grows with its age", dot: "rgb(255,64,170)" },
  { label: "fix snapped onto the track (pink tether = snap offset)", dot: "rgb(255,176,32)" },
  { label: "drawn train, easing along the arc", dot: "rgb(90,220,255)" },
  { label: "prediction arc → arrowhead = direction of travel", dot: "rgb(80,240,140)" },
];

function DebugLegend() {
  // Desktop-only: on a phone it would sit under the station sheet.
  return (
    <div className="pointer-events-none absolute bottom-5 right-5 hidden max-w-[300px] select-none rounded-md border border-white/10 bg-black/40 px-3 py-2 backdrop-blur-sm sm:block">
      <div className="mb-1 text-[9px] uppercase tracking-[0.28em] text-white/40">interpolation</div>
      <div className="flex flex-col gap-1">
        {DEBUG_KEYS.map((k) => (
          <div key={k.label} className="flex items-center gap-2 text-[10px] text-white/70">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: k.dot }}
            />
            <span>{k.label}</span>
          </div>
        ))}
        <div className="mt-1 border-t border-white/10 pt-1 text-[10px] leading-snug text-white/50">
          label: fix age · measured speed · predicted meters.
          <br />
          amber arc + <span className="text-amber-300/80">corr</span> = easing backward to a fresh
          fix — the arrowhead stays locked on travel direction (from the next stop).
        </div>
      </div>
    </div>
  );
}

const LOCATE_TITLE: Record<GeoState, string> = {
  idle: "Show my location",
  prompting: "Waiting for your location…",
  active: "Center on me",
  denied: "Location is blocked for this site — allow it in your browser settings",
  unavailable: "This browser can't share a location",
  error: "Location is unavailable right now — showing the last known fix",
};

/** Crosshair: off → dim, waiting → pulsing, live → azure (the map dot's color). */
function LocateButton({
  state,
  active,
  onClick,
}: {
  state: GeoState;
  active: boolean;
  onClick: () => void;
}) {
  const blocked = state === "denied" || state === "unavailable";
  const tone = blocked
    ? "text-white/25"
    : active
      ? "text-[rgb(64,156,255)]"
      : state === "error"
        ? "text-amber-300/70"
        : "text-white/60";
  return (
    <button
      type="button"
      onClick={onClick}
      title={LOCATE_TITLE[state]}
      aria-label={LOCATE_TITLE[state]}
      aria-pressed={active}
      className={`grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-black/55 backdrop-blur-md transition hover:border-white/20 ${tone} ${
        state === "prompting" ? "animate-pulse" : ""
      }`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="6.5" />
        <path d="M12 1.5v3.5M12 19v3.5M1.5 12h3.5M19 12h3.5" strokeLinecap="round" />
        <circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none" />
      </svg>
    </button>
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
