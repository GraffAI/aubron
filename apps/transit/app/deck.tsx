"use client";

import DeckGL from "@deck.gl/react";
import type { MapViewState, PickingInfo } from "deck.gl";
import {
  FlyToInterpolator,
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
import { type Focus, fitBounds } from "./lib/camera";
import { colorFor, COLORS, LINE_COLORS, RAIL_FALLBACK, type RGBA } from "./lib/theme";
import { TrackIndex } from "./lib/track";
import {
  type Filter,
  isOnTime,
  type Mode,
  type NetworkData,
  type SelectedLine,
  type ShapeLine,
  type StopInfo,
  type Vehicle,
} from "./lib/transit";
import { type SmoothVehicle, usePageVisible, useSmoothPositions } from "./lib/useSmoothPositions";

// The upstream feed refreshes each train's fix every ~20s median (p90 35s,
// measured 2026-07), and a fix is already ~16s old when it first appears — a lag
// no poll rate can undo. We poll at well under the refresh period so we catch
// each new fix within ~8s; /api/vehicles memoizes ~5s so this doesn't multiply
// upstream load. useSmoothPositions then carries moving trains forward
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

const BUS_COLOR = LINE_COLORS.bus ?? RAIL_FALLBACK;
const routeColor = (shortName: string, mode: Mode, gtfsColor?: string): RGBA =>
  mode === "bus" ? BUS_COLOR : colorFor(shortName, gtfsColor);

interface Props {
  net: NetworkData | null;
  filter: Filter;
  /** When set, the map isolates to this line and draws its stops prominently. */
  selectedLine: SelectedLine | null;
  /** Live vehicles for a selected bus line (rail lines reuse the network feed). */
  lineBusVehicles: Vehicle[];
  /** Currently opened station, highlighted on the map. */
  selectedStopId: string | null;
  /** Camera target; a new nonce re-triggers the fly even to the same place. */
  focus: Focus | null;
  /**
   * When set, live polling stops and these recorded vehicles ride the map
   * instead — through the same track-snapped smoothing, with the glide time
   * compressed to the playback speed.
   */
  replay?: { vehicles: Vehicle[]; tweenMs: number } | null;
  onVehicles?: (v: Vehicle[]) => void;
  onBuses?: (v: Vehicle[]) => void;
  onSelect?: (v: Vehicle | null) => void;
  onSelectStop?: (s: StopInfo | null) => void;
}

interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
}

export function TransitDeck({
  net,
  filter,
  selectedLine,
  lineBusVehicles,
  selectedStopId,
  focus,
  replay,
  onVehicles,
  onBuses,
  onSelect,
  onSelectStop,
}: Props) {
  const [base, setBase] = useState<Basemap | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [buses, setBuses] = useState<Vehicle[]>([]);
  // initialViewState doubles as the fly trigger: updating it (with transition props)
  // makes deck glide there, while the controller still owns user pan/zoom.
  const [viewState, setViewState] = useState<MapViewState>(INITIAL_VIEW_STATE);
  const viewRef = useRef<ViewState>(INITIAL_VIEW_STATE);
  const visible = usePageVisible();

  // Parent callbacks in refs → stable effects/fetchers (no refetch loops).
  const onVehiclesRef = useRef(onVehicles);
  onVehiclesRef.current = onVehicles;
  const onBusesRef = useRef(onBuses);
  onBusesRef.current = onBuses;
  const busesOnRef = useRef(filter.buses);
  busesOnRef.current = filter.buses;

  // Basemap once.
  useEffect(() => {
    const c = new AbortController();
    loadBasemap(c.signal)
      .catch(() => null)
      .then((b) => b && setBase(b));
    return () => c.abort();
  }, []);

  // Smooth camera fly whenever a fresh focus comes in (line picked, station framed).
  useEffect(() => {
    if (!focus) return;
    const width = typeof window === "undefined" ? 1440 : window.innerWidth;
    const height = typeof window === "undefined" ? 900 : window.innerHeight;
    const target = fitBounds(focus.bounds, width, height, {
      padding: focus.padding ?? 90,
      maxZoom: focus.maxZoom ?? 15,
    });
    setViewState({
      ...INITIAL_VIEW_STATE,
      ...target,
      transitionDuration: 1500,
      transitionInterpolator: new FlyToInterpolator({ speed: 1.6 }),
    });
  }, [focus]);

  // A replay substitutes for the live rail feed; report it up (counts, filters).
  const replaying = !!replay;
  useEffect(() => {
    if (!replay) return;
    onVehiclesRef.current?.(replay.vehicles);
  }, [replay]);

  // Rail vehicles, network-wide — only while the tab is foregrounded.
  useEffect(() => {
    if (!visible || replaying) return;
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
  }, [visible, replaying]);

  // Viewport buses — only in the ambient overview (a drilled-in line shows its own).
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

  const overviewBuses = !selectedLine && filter.buses && !replaying;
  useEffect(() => {
    if (!overviewBuses) {
      setBuses([]);
      onBusesRef.current?.([]);
      return;
    }
    if (!visible) return;
    void fetchBuses();
    const id = setInterval(() => void fetchBuses(), BUS_POLL_MS);
    return () => clearInterval(id);
  }, [overviewBuses, fetchBuses, visible]);

  // Pan/zoom: remember the view, and (debounced) refetch buses for the new area.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Route geometry as a 1-D track, so rail glides ride the rails (buses have no
  // shapes here, so they fall back to a straight glide inside the hook).
  const track = useMemo(() => (net ? new TrackIndex(net) : null), [net]);

  // Smooth, tripId-keyed interpolation (the fix for trains flying across).
  const railSmooth = useSmoothPositions(
    replay ? replay.vehicles : vehicles,
    replay ? replay.tweenMs : POSITION_TWEEN_MS,
    track,
    filter.debug,
  );
  const busViewportSmooth = useSmoothPositions(buses, POSITION_TWEEN_MS);
  const busLineSmooth = useSmoothPositions(lineBusVehicles, POSITION_TWEEN_MS);

  const passOnTime = (v: Vehicle) => !filter.onTimeOnly || isOnTime(v.deviation);

  // What rides on the map depends on whether we're drilled into a line.
  let railShown: SmoothVehicle[];
  let busShown: SmoothVehicle[];
  if (selectedLine) {
    if (selectedLine.mode === "bus") {
      railShown = [];
      busShown = busLineSmooth.filter(passOnTime);
    } else {
      railShown = railSmooth.filter((v) => v.routeId === selectedLine.routeId && passOnTime(v));
      busShown = [];
    }
  } else {
    railShown = railSmooth.filter((v) => filter.lines.has(v.shortName) && passOnTime(v));
    busShown = filter.buses ? busViewportSmooth.filter(passOnTime) : [];
  }

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

  // Overview routes: every rail line the filter has on, with faint shared stops.
  const overviewRouteLayers = useMemo(() => {
    if (!net || selectedLine) return [];
    const shown = net.shapes.filter((sh) => filter.lines.has(sh.shortName));
    return [
      new PathLayer<ShapeLine>({
        id: "routes-glow",
        data: shown,
        getPath: (d) => d.path,
        getColor: (d) => {
          const [r, g, b] = colorFor(d.shortName, d.color);
          return [r, g, b, 28];
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
        getColor: (d) => colorFor(d.shortName, d.color),
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
  }, [net, filter.lines, selectedLine]);

  // Drilled-in line: the chosen line drawn bold, its stops big, named, and clickable.
  const lineLayers = useMemo(() => {
    if (!selectedLine) return [];
    const col = routeColor(selectedLine.shortName, selectedLine.mode, selectedLine.color);
    const [r, g, b] = col;
    return [
      new PathLayer<ShapeLine>({
        id: "line-glow",
        data: selectedLine.shapes,
        getPath: (d) => d.path,
        getColor: [r, g, b, 44],
        widthUnits: "pixels",
        getWidth: 12,
        capRounded: true,
        jointRounded: true,
      }),
      new PathLayer<ShapeLine>({
        id: "line",
        data: selectedLine.shapes,
        getPath: (d) => d.path,
        getColor: [r, g, b, 255],
        widthUnits: "pixels",
        getWidth: 3.6,
        widthMinPixels: 2.5,
        capRounded: true,
        jointRounded: true,
      }),
      // Soft halo so stops read as touchable targets.
      new ScatterplotLayer<StopInfo>({
        id: "line-stop-halo",
        data: selectedLine.stops,
        getPosition: (d) => [d.lon, d.lat],
        getRadius: (d) => (d.id === selectedStopId ? 13 : 8),
        radiusUnits: "pixels",
        getFillColor: (d) => [r, g, b, d.id === selectedStopId ? 70 : 28],
        updateTriggers: { getRadius: selectedStopId, getFillColor: selectedStopId },
      }),
      new ScatterplotLayer<StopInfo>({
        id: "line-stops",
        data: selectedLine.stops,
        pickable: true,
        getPosition: (d) => [d.lon, d.lat],
        getRadius: (d) => (d.id === selectedStopId ? 6 : 4.5),
        radiusUnits: "pixels",
        radiusMinPixels: 3.5,
        getFillColor: (d) => (d.id === selectedStopId ? [r, g, b, 255] : [10, 14, 20, 255]),
        stroked: true,
        getLineColor: [r, g, b, 255],
        lineWidthUnits: "pixels",
        getLineWidth: 1.6,
        onClick: (info: PickingInfo<StopInfo>) => {
          onSelectStop?.(info.object ?? null);
          return true;
        },
        updateTriggers: { getRadius: selectedStopId, getFillColor: selectedStopId },
      }),
      new TextLayer<StopInfo>({
        id: "line-stop-labels",
        data: selectedLine.stops,
        getPosition: (d) => [d.lon, d.lat],
        getText: (d) => d.name,
        getSize: 11,
        sizeUnits: "pixels",
        getColor: (d) => (d.id === selectedStopId ? [255, 255, 255, 235] : [220, 230, 240, 150]),
        getPixelOffset: [0, -12],
        getTextAnchor: "middle",
        getAlignmentBaseline: "bottom",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        fontWeight: 600,
        outlineWidth: 2,
        outlineColor: [3, 6, 10, 255],
        fontSettings: { sdf: true },
        updateTriggers: { getColor: selectedStopId },
      }),
    ];
  }, [selectedLine, selectedStopId, onSelectStop]);

  const selectVehicle = (info: PickingInfo<Vehicle>) => {
    onSelect?.(info.object ?? null);
    return true;
  };

  // Vehicle layers — positions already interpolated by useSmoothPositions, so no
  // deck transitions here (those are index-based and caused the swapping).
  //
  // A train rides a line drawn in its own color, so the marker is layered for
  // contrast, not tinted to match: a soft line-colored halo for presence, a
  // bright body with a dark hairline edge that lifts it off the same-colored
  // route (the key to spotting trains at any zoom), then a line-colored arrow
  // on top carrying identity + heading. All pixel-sized, so the train is the
  // same mark whether you're zoomed to the whole network or a single platform.
  const vehicleLayers = [
    new ScatterplotLayer<Vehicle>({
      id: "buses",
      data: busShown,
      pickable: true,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: selectedLine ? 4 : 2.8,
      radiusUnits: "pixels",
      radiusMinPixels: 2,
      getFillColor: (d) => [BUS_COLOR[0], BUS_COLOR[1], BUS_COLOR[2], staleAlpha(d)],
      stroked: true,
      getLineColor: (d) => [
        COLORS.markerEdge[0],
        COLORS.markerEdge[1],
        COLORS.markerEdge[2],
        Math.min(160, staleAlpha(d)),
      ],
      lineWidthUnits: "pixels",
      getLineWidth: 0.75,
      onClick: selectVehicle,
      updateTriggers: { getRadius: !!selectedLine },
    }),
    new ScatterplotLayer<Vehicle>({
      id: "vehicle-glow",
      data: railShown,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: selectedLine ? 12 : 10,
      radiusUnits: "pixels",
      getFillColor: (d) => {
        const [r, g, b] = colorFor(d.shortName, d.color);
        return [r, g, b, d.hasGps ? 48 : 16];
      },
      updateTriggers: { getRadius: !!selectedLine },
    }),
    new ScatterplotLayer<Vehicle>({
      id: "vehicle-body",
      data: railShown,
      pickable: true,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: selectedLine ? 7 : 6,
      radiusUnits: "pixels",
      radiusMinPixels: 4,
      getFillColor: (d) => [
        COLORS.markerCore[0],
        COLORS.markerCore[1],
        COLORS.markerCore[2],
        staleAlpha(d),
      ],
      stroked: true,
      getLineColor: (d) => [
        COLORS.markerEdge[0],
        COLORS.markerEdge[1],
        COLORS.markerEdge[2],
        staleAlpha(d),
      ],
      lineWidthUnits: "pixels",
      getLineWidth: 1.25,
      lineWidthMinPixels: 1,
      onClick: selectVehicle,
      updateTriggers: { getRadius: !!selectedLine },
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
        anchorY: 12,
        mask: true,
      }),
      getSize: selectedLine ? 11 : 9.5,
      sizeUnits: "pixels",
      getColor: (d) => {
        const [r, g, b] = colorFor(d.shortName, d.color);
        return [r, g, b, staleAlpha(d)];
      },
      getAngle: (d) => -d.heading, // icon points north at 0; heading is CW from north
      onClick: selectVehicle,
      updateTriggers: { getSize: !!selectedLine },
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
      layers={[
        ...baseLayers,
        ...overviewRouteLayers,
        ...lineLayers,
        ...vehicleLayers,
        ...debugLayers,
      ]}
      views={new MapView({ repeat: false })}
      initialViewState={viewState}
      controller={{ dragRotate: false }}
      onViewStateChange={(p) => {
        const vs = p.viewState as unknown as ViewState;
        viewRef.current = { longitude: vs.longitude, latitude: vs.latitude, zoom: vs.zoom };
        if (!overviewBuses) return;
        if (debounce.current) clearTimeout(debounce.current);
        debounce.current = setTimeout(() => void fetchBuses(), 600);
      }}
      pickingRadius={14} // generous for touch — station dots are only ~5px
      style={{ position: "absolute", inset: "0" }}
      getCursor={({ isHovering }) => (isHovering ? "pointer" : "grab")}
      getTooltip={({ object }: PickingInfo<Vehicle | StopInfo>) => {
        if (!object) return null;
        if ("headsign" in object) {
          return {
            text: `${object.shortName} → ${object.headsign}${object.hasGps ? "" : " (scheduled)"}`,
          };
        }
        return { text: object.name };
      }}
      onClick={(info: PickingInfo) => {
        // A click on empty space clears the trip selection (stops handle their own).
        if (!info.object) onSelect?.(null);
      }}
    />
  );
}
