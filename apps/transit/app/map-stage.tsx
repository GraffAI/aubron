"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { boundsOfPaths, boundsOfPoints, type Focus } from "./lib/camera";
import { LINE_COLORS, type RGBA } from "./lib/theme";
import type {
  Filter,
  NetworkData,
  RouteGeometry,
  SelectedLine,
  StopArrival,
  StopBoard,
  StopInfo,
  Vehicle,
} from "./lib/transit";
import { LineSelector } from "./line-selector";
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
  const focusNonce = useRef(0);
  const framedTrip = useRef<string | null>(null);
  const deepLinked = useRef(false);

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

  // When a station opens, frame it; refine to keep the soonest incoming vehicle in
  // shot once the board reports one (but don't chase every poll — only on change).
  useEffect(() => {
    if (!stop) {
      framedTrip.current = null;
      return;
    }
    flyTo({
      bounds: boundsOfPoints([[stop.lon, stop.lat]])!,
      padding: { top: 90, bottom: 170, left: 120, right: 120 },
      maxZoom: 14.5,
    });
  }, [stop, flyTo]);

  useEffect(() => {
    if (!stop || !board) return;
    const inc = board.arrivals.find((a) => a.vehicleLon != null && a.vehicleLat != null);
    if (!inc || framedTrip.current === inc.tripId) return;
    framedTrip.current = inc.tripId;
    const b = boundsOfPoints([
      [stop.lon, stop.lat],
      [inc.vehicleLon!, inc.vehicleLat!],
    ]);
    if (b)
      flyTo({ bounds: b, padding: { top: 100, bottom: 180, left: 140, right: 140 }, maxZoom: 14 });
  }, [board, stop, flyTo]);

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
    const b = boundsOfPoints([
      [stop.lon, stop.lat],
      [a.vehicleLon, a.vehicleLat],
    ]);
    if (b)
      flyTo({ bounds: b, padding: { top: 100, bottom: 180, left: 140, right: 140 }, maxZoom: 14 });
  };

  const toggleLine = (name: string) =>
    setFilter((f) => {
      const lines = new Set(f.lines);
      if (lines.has(name)) lines.delete(name);
      else lines.add(name);
      return { ...f, lines };
    });

  const handleBuses = useCallback((b: Vehicle[]) => setBusCount(b.length), []);

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
        focus={focus}
        onVehicles={setVehicles}
        onBuses={handleBuses}
        onSelect={setSelected}
        onSelectStop={setStop}
      />

      {/* top-left: wordmark + the line selector (the drill-down's front door) */}
      <div className="absolute left-5 top-5 flex flex-col gap-3">
        <div className="pointer-events-none select-none">
          <div className="text-[11px] font-medium uppercase tracking-[0.32em] text-white/70">
            Puget Sound
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.28em] text-cyan-300/50">
            transit · live
          </div>
        </div>
        <LineSelector
          rail={railRoutes}
          buses={busRoutes}
          selectedId={lineId}
          onSelect={selectLine}
          counts={counts}
        />
        {line && (
          <div className="pointer-events-none max-w-[260px] text-[10px] uppercase tracking-[0.22em] text-white/40">
            {liveOnLine} live · tap a station for arrivals
          </div>
        )}
      </div>

      {/* top-right: overview filters (ambient view only) or focused toggles */}
      <div className="absolute right-5 top-5 select-none text-right">
        {!line ? (
          <>
            <div className="mb-2 text-[10px] uppercase tracking-[0.28em] text-white/40">
              {vehicles.length} trains{filter.buses ? ` · ${busCount} buses` : ""} live
            </div>
            <div className="flex flex-col items-end gap-1">
              {railRoutes.map((l) => {
                const on = filter.lines.has(l.shortName);
                const n = counts.get(l.shortName) ?? 0;
                const color = LINE_COLORS[l.shortName] ?? [150, 170, 190, 220];
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

      {filter.debug && <DebugLegend />}

      {stop && (
        <StationPanel
          board={board}
          loading={boardLoading}
          onClose={() => setStop(null)}
          onPick={frameArrival}
        />
      )}

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
    <div className="pointer-events-none absolute bottom-5 right-5 select-none rounded-md border border-white/10 bg-black/40 px-3 py-2 backdrop-blur-sm">
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
