"use client";

import DeckGL from "@deck.gl/react";
import type { PickingInfo } from "deck.gl";
import {
  GeoJsonLayer,
  IconLayer,
  MapView,
  PathLayer,
  ScatterplotLayer,
  TextLayer,
  WebMercatorViewport,
} from "deck.gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type Basemap, loadBasemap } from "./lib/basemap";
import { COLORS, LINE_COLORS, type RGBA } from "./lib/theme";
import { TrackIndex } from "./lib/track";
import {
  type Filter,
  isOnTime,
  type NetworkData,
  type ShapeLine,
  type StopInfo,
  type Vehicle,
} from "./lib/transit";
import { type SmoothVehicle, usePageVisible, useSmoothPositions } from "./lib/useSmoothPositions";

// The upstream feed refreshes all trains together in bursts every ~16s (measured),
// and each fix already arrives ~18s stale — a lag no poll rate can undo. We poll at
// ~half the burst period so we catch each batch within ~8s (15s would beat in and
// out of phase with the 16s cadence); /api/vehicles memoizes ~5s so this doesn't
// multiply upstream load. useSmoothPositions then carries moving trains forward
// along the track at their schedule-paced speed so the dot tracks ~real-time.
// Interpolation is keyed by tripId (not deck's index-based transitions, which swap
// vehicles when the set changes).
const RAIL_POLL_MS = 8_000;
const BUS_POLL_MS = 20_000;
const POSITION_TWEEN_MS = 15_000;

// Schedule-only "ghost" trains (no live GPS) render faint — a prediction, not a fix.
const GHOST_ALPHA = 90;

// Debug overlay palette — keep in sync with the legend in map-stage.tsx.
const DBG_RAW: RGBA = [255, 64, 170, 255]; // last raw GPS fix
const DBG_ANCHOR: RGBA = [255, 176, 32, 255]; // fix snapped onto the track
const DBG_SMOOTH: RGBA = [90, 220, 255, 255]; // interpolated (drawn) position
const DBG_TARGET: RGBA = [80, 240, 140, 255]; // where the glide is heading

const ARROW_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 2 L20.5 22 L12 17 L3.5 22 Z" fill="white"/></svg>',
)}`;

// Fade ghosts (schedule-only, no GPS) and vehicles whose GPS has gone stale.
const staleAlpha = (v: Vehicle): number =>
  !v.hasGps ? GHOST_ALPHA : v.gpsAgeSec && v.gpsAgeSec > 150 ? 110 : 255;

const INITIAL_VIEW_STATE = {
  longitude: -122.33,
  latitude: 47.62,
  zoom: 10.6,
  minZoom: 8,
  maxZoom: 16,
  pitch: 0,
  bearing: 0,
};

const RAIL_FALLBACK: RGBA = [150, 170, 190, 220];
const BUS_COLOR = LINE_COLORS.bus ?? RAIL_FALLBACK;
const lineColor = (shortName: string): RGBA => LINE_COLORS[shortName] ?? RAIL_FALLBACK;

interface Props {
  filter: Filter;
  onVehicles?: (v: Vehicle[]) => void;
  onBuses?: (v: Vehicle[]) => void;
  onSelect?: (v: Vehicle | null) => void;
}

interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
}

export function TransitDeck({ filter, onVehicles, onBuses, onSelect }: Props) {
  const [base, setBase] = useState<Basemap | null>(null);
  const [net, setNet] = useState<NetworkData | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [buses, setBuses] = useState<Vehicle[]>([]);
  const viewRef = useRef<ViewState>(INITIAL_VIEW_STATE);
  const visible = usePageVisible();

  // Parent callbacks in refs → stable effects/fetchers (no refetch loops).
  const onVehiclesRef = useRef(onVehicles);
  onVehiclesRef.current = onVehicles;
  const onBusesRef = useRef(onBuses);
  onBusesRef.current = onBuses;
  const busesOnRef = useRef(filter.buses);
  busesOnRef.current = filter.buses;

  // Basemap + network once.
  useEffect(() => {
    const c = new AbortController();
    loadBasemap(c.signal)
      .catch(() => null)
      .then((b) => b && setBase(b));
    fetch("/api/network", { signal: c.signal })
      .then((r) => r.json())
      .then((n: NetworkData) => setNet(n))
      .catch(() => null);
    return () => c.abort();
  }, []);

  // Rail vehicles, network-wide — only while the tab is foregrounded.
  useEffect(() => {
    if (!visible) return;
    let active = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/vehicles");
        const j = (await r.json()) as { vehicles?: Vehicle[] };
        if (active && j.vehicles) {
          const sorted = [...j.vehicles].sort((a, b) => (a.id < b.id ? -1 : 1));
          setVehicles(sorted);
          onVehiclesRef.current?.(sorted);
        }
      } catch {
        /* keep last good positions */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), RAIL_POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [visible]);

  // Viewport buses — stable (no prop deps), guarded against stale results.
  const fetchBuses = useCallback(async () => {
    const v = viewRef.current;
    const vp = new WebMercatorViewport({
      width: typeof window === "undefined" ? 1440 : window.innerWidth,
      height: typeof window === "undefined" ? 900 : window.innerHeight,
      longitude: v.longitude,
      latitude: v.latitude,
      zoom: v.zoom,
    });
    const b = vp.getBounds(); // [minLng, minLat, maxLng, maxLat]
    const [w, s, e, n] = b as unknown as [number, number, number, number];
    const lat = (s + n) / 2;
    const lon = (w + e) / 2;
    const latSpan = Math.abs(n - s);
    const lonSpan = Math.abs(e - w);
    try {
      const r = await fetch(
        `/api/area?lat=${lat}&lon=${lon}&latSpan=${latSpan}&lonSpan=${lonSpan}`,
      );
      const j = (await r.json()) as { vehicles?: Vehicle[] };
      if (!busesOnRef.current) return; // toggled off while in flight — drop it
      const next = [...(j.vehicles ?? [])].sort((a, b2) => (a.id < b2.id ? -1 : 1));
      setBuses(next);
      onBusesRef.current?.(next);
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    if (!filter.buses) {
      setBuses([]);
      onBusesRef.current?.([]);
      return;
    }
    if (!visible) return;
    void fetchBuses();
    const id = setInterval(() => void fetchBuses(), BUS_POLL_MS);
    return () => clearInterval(id);
  }, [filter.buses, fetchBuses, visible]);

  // Pan/zoom: remember the view, and (debounced) refetch buses for the new area.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Route geometry as a 1-D track, so rail glides ride the rails (buses have no
  // shapes here, so they fall back to a straight glide inside the hook).
  const track = useMemo(() => (net ? new TrackIndex(net) : null), [net]);

  // Smooth, tripId-keyed interpolation (the fix for trains flying across).
  const railSmooth = useSmoothPositions(vehicles, POSITION_TWEEN_MS, track, filter.debug);
  const busSmooth = useSmoothPositions(buses, POSITION_TWEEN_MS);

  const passOnTime = (v: Vehicle) => !filter.onTimeOnly || isOnTime(v.deviation);
  const railShown = railSmooth.filter((v) => filter.lines.has(v.shortName) && passOnTime(v));
  const busShown = filter.buses ? busSmooth.filter(passOnTime) : [];

  // Static layers don't change per animation frame — memoize so only the vehicle
  // layers rebuild at 60fps.
  const baseLayers = useMemo(() => {
    if (!base) return [];
    // void background (land tone) → lit marine water → land on top (masks any
    // bleed, keeps islands dark) → lit lakes → faint roads → muted shoreline edge.
    return [
      new GeoJsonLayer({
        id: "marine",
        data: base.marine,
        filled: true,
        stroked: false,
        getFillColor: COLORS.waterFill,
      }),
      new GeoJsonLayer({
        id: "land",
        data: base.land,
        filled: true,
        stroked: false,
        getFillColor: COLORS.void,
      }),
      new GeoJsonLayer({
        id: "lakes",
        data: base.lakes,
        filled: true,
        stroked: true,
        getFillColor: COLORS.waterFill,
        getLineColor: COLORS.waterEdge,
        lineWidthUnits: "pixels",
        getLineWidth: 0.75,
        lineWidthMinPixels: 0.5,
      }),
      new GeoJsonLayer({
        id: "roads",
        data: base.roads,
        stroked: true,
        filled: false,
        getLineColor: COLORS.road,
        lineWidthUnits: "pixels",
        getLineWidth: 1,
        lineWidthMinPixels: 0.5,
      }),
      new GeoJsonLayer({
        id: "coastline",
        data: base.coastline,
        stroked: true,
        filled: false,
        getLineColor: COLORS.waterEdge,
        lineWidthUnits: "pixels",
        getLineWidth: 0.75,
        lineWidthMinPixels: 0.5,
      }),
    ];
  }, [base]);

  const routeLayers = useMemo(() => {
    if (!net) return [];
    const shown = net.shapes.filter((sh) => filter.lines.has(sh.shortName));
    return [
      new PathLayer<ShapeLine>({
        id: "routes-glow",
        data: shown,
        getPath: (d) => d.path,
        getColor: (d) => {
          const [r, g, b] = lineColor(d.shortName);
          return [r, g, b, 38];
        },
        widthUnits: "pixels",
        getWidth: 8,
        capRounded: true,
        jointRounded: true,
      }),
      new PathLayer<ShapeLine>({
        id: "routes",
        data: shown,
        getPath: (d) => d.path,
        getColor: (d) => lineColor(d.shortName),
        widthUnits: "pixels",
        getWidth: 2.4,
        widthMinPixels: 1.4,
        capRounded: true,
        jointRounded: true,
      }),
      new ScatterplotLayer<StopInfo>({
        id: "stops",
        data: net.stops,
        getPosition: (d) => [d.lon, d.lat],
        getRadius: 2.4,
        radiusUnits: "pixels",
        radiusMinPixels: 1.5,
        getFillColor: [8, 12, 18, 255],
        stroked: true,
        getLineColor: [150, 180, 200, 120],
        lineWidthUnits: "pixels",
        getLineWidth: 1,
      }),
    ];
  }, [net, filter.lines]);

  const selectVehicle = (info: PickingInfo<Vehicle>) => {
    onSelect?.(info.object ?? null);
    return true;
  };

  // Vehicle layers — positions already interpolated by useSmoothPositions, so no
  // deck transitions here (those are index-based and caused the swapping).
  const vehicleLayers = [
    new ScatterplotLayer<Vehicle>({
      id: "buses",
      data: busShown,
      pickable: true,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 2.8,
      radiusUnits: "pixels",
      radiusMinPixels: 2,
      getFillColor: (d) => [BUS_COLOR[0], BUS_COLOR[1], BUS_COLOR[2], staleAlpha(d)],
      stroked: false,
      onClick: selectVehicle,
    }),
    new ScatterplotLayer<Vehicle>({
      id: "vehicle-glow",
      data: railShown,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 11,
      radiusUnits: "pixels",
      getFillColor: (d) => {
        const [r, g, b] = lineColor(d.shortName);
        return [r, g, b, d.hasGps ? 55 : 18];
      },
    }),
    new IconLayer<Vehicle>({
      id: "vehicles",
      data: railShown,
      pickable: true,
      getPosition: (d) => [d.lon, d.lat],
      getIcon: () => ({
        url: ARROW_ICON,
        width: 24,
        height: 24,
        anchorX: 12,
        anchorY: 13,
        mask: true,
      }),
      getSize: 18,
      sizeUnits: "pixels",
      getColor: (d) => {
        const [r, g, b] = lineColor(d.shortName);
        return [r, g, b, staleAlpha(d)];
      },
      getAngle: (d) => -d.heading, // icon points north at 0; heading is CW from north
      onClick: selectVehicle,
    }),
  ];

  // Debug overlay: peel back each train to its raw fix, the snapped anchor, the
  // smooth drawn position, and the prediction target it's gliding toward — plus a
  // ring/label for how stale the fix is. Rebuilt per frame alongside the trains.
  const dbg = filter.debug
    ? railShown.filter(
        (d): d is SmoothVehicle & { debug: NonNullable<SmoothVehicle["debug"]> } => !!d.debug,
      )
    : [];
  const debugLayers = filter.debug
    ? [
        new PathLayer<(typeof dbg)[number]>({
          id: "dbg-path",
          data: dbg,
          getPath: (d) => [
            [d.debug.rawLon, d.debug.rawLat],
            [d.debug.anchorLon, d.debug.anchorLat],
            [d.debug.targetLon, d.debug.targetLat],
          ],
          getColor: [255, 176, 32, 110],
          widthUnits: "pixels",
          getWidth: 1,
          widthMinPixels: 1,
        }),
        new ScatterplotLayer<(typeof dbg)[number]>({
          id: "dbg-age",
          data: dbg,
          getPosition: (d) => [d.debug.rawLon, d.debug.rawLat],
          // Ring grows with the age of the fix (capped so a parked train stays sane).
          getRadius: (d) => 3 + Math.min(40, d.debug.gpsAgeSec ?? 0) * 0.4,
          radiusUnits: "pixels",
          stroked: true,
          filled: false,
          getLineColor: [DBG_RAW[0], DBG_RAW[1], DBG_RAW[2], 90],
          lineWidthUnits: "pixels",
          getLineWidth: 1,
        }),
        new ScatterplotLayer<(typeof dbg)[number]>({
          id: "dbg-target",
          data: dbg,
          getPosition: (d) => [d.debug.targetLon, d.debug.targetLat],
          getRadius: 2.5,
          radiusUnits: "pixels",
          getFillColor: DBG_TARGET,
        }),
        new ScatterplotLayer<(typeof dbg)[number]>({
          id: "dbg-anchor",
          data: dbg,
          getPosition: (d) => [d.debug.anchorLon, d.debug.anchorLat],
          getRadius: 2.5,
          radiusUnits: "pixels",
          getFillColor: DBG_ANCHOR,
        }),
        new ScatterplotLayer<(typeof dbg)[number]>({
          id: "dbg-raw",
          data: dbg,
          getPosition: (d) => [d.debug.rawLon, d.debug.rawLat],
          getRadius: 3,
          radiusUnits: "pixels",
          getFillColor: DBG_RAW,
        }),
        new ScatterplotLayer<(typeof dbg)[number]>({
          id: "dbg-smooth",
          data: dbg,
          getPosition: (d) => [d.lon, d.lat],
          getRadius: 2,
          radiusUnits: "pixels",
          getFillColor: DBG_SMOOTH,
        }),
        new TextLayer<(typeof dbg)[number]>({
          id: "dbg-age-text",
          data: dbg,
          getPosition: (d) => [d.debug.rawLon, d.debug.rawLat],
          getText: (d) => `${d.debug.gpsAgeSec ?? "?"}s · ${(d.debug.speed * 3.6).toFixed(0)}km/h`,
          getSize: 9,
          sizeUnits: "pixels",
          getColor: [255, 255, 255, 180],
          getPixelOffset: [0, -12],
          getTextAnchor: "middle",
          getAlignmentBaseline: "bottom",
          fontFamily: "ui-monospace, monospace",
        }),
      ]
    : [];

  return (
    <DeckGL
      layers={[...baseLayers, ...routeLayers, ...vehicleLayers, ...debugLayers]}
      views={new MapView({ repeat: false })}
      initialViewState={INITIAL_VIEW_STATE}
      controller={{ dragRotate: false }}
      onViewStateChange={(p) => {
        const vs = p.viewState as unknown as ViewState;
        viewRef.current = { longitude: vs.longitude, latitude: vs.latitude, zoom: vs.zoom };
        if (!filter.buses) return;
        if (debounce.current) clearTimeout(debounce.current);
        debounce.current = setTimeout(() => void fetchBuses(), 600);
      }}
      pickingRadius={8}
      style={{ position: "absolute", inset: "0" }}
      getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
      getTooltip={({ object }: PickingInfo<Vehicle>) =>
        object
          ? {
              text: `${object.shortName} → ${object.headsign}${object.hasGps ? "" : " (scheduled)"}`,
            }
          : null
      }
      onClick={(info: PickingInfo) => {
        if (!info.object) onSelect?.(null);
      }}
    />
  );
}
