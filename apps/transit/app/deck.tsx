"use client";

import DeckGL from "@deck.gl/react";
import type { PickingInfo } from "deck.gl";
import {
  GeoJsonLayer,
  IconLayer,
  MapView,
  PathLayer,
  ScatterplotLayer,
  WebMercatorViewport,
} from "deck.gl";
import { useCallback, useEffect, useRef, useState } from "react";

import { type Basemap, loadBasemap } from "./lib/basemap";
import { COLORS, LINE_COLORS, type RGBA } from "./lib/theme";
import {
  type Filter,
  isOnTime,
  type NetworkData,
  type ShapeLine,
  type StopInfo,
  type Vehicle,
} from "./lib/transit";

// The live feed only refreshes a vehicle's GPS every ~25-30s (measured), so the
// data sits still then jumps. We poll a bit faster than that to catch updates
// promptly, and tween over ~the update gap so motion looks continuous instead of
// teleporting. Polling faster than this would mostly fetch identical data.
const RAIL_POLL_MS = 15_000;
const BUS_POLL_MS = 20_000;
const POSITION_TWEEN_MS = 26_000;

// Directional arrowhead (points "up" = north by default; rotated by heading).
const ARROW_ICON = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M12 2 L20.5 22 L12 17 L3.5 22 Z" fill="white"/></svg>',
)}`;

// Fade vehicles whose GPS has gone stale (lost signal / parked off-grid).
const staleAlpha = (v: Vehicle): number => (v.gpsAgeSec && v.gpsAgeSec > 150 ? 110 : 255);

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

  // Keep parent callbacks in refs so our effects/fetchers stay stable — passing
  // an inline `onBuses` used to re-create fetchBuses every render, which spun the
  // bus effect into a refetch loop (the thread thrash made the whole map janky).
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

  // Rail vehicles, network-wide, every 15s.
  useEffect(() => {
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
  }, []);

  // Viewport buses — only while the Buses filter is on. Stable (no prop deps).
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
    void fetchBuses();
    const id = setInterval(() => void fetchBuses(), BUS_POLL_MS);
    return () => clearInterval(id);
  }, [filter.buses, fetchBuses]);

  // Pan/zoom: remember the view, and (debounced) refetch buses for the new area.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const passOnTime = (v: Vehicle) => !filter.onTimeOnly || isOnTime(v.deviation);
  const railShown = vehicles.filter((v) => filter.lines.has(v.shortName) && passOnTime(v));
  const busShown = filter.buses ? buses.filter(passOnTime) : [];

  const layers = [];

  if (base) {
    layers.push(
      new GeoJsonLayer({
        id: "water",
        data: base.water,
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
        getLineColor: COLORS.coastline,
        lineWidthUnits: "pixels",
        getLineWidth: 1.1,
        lineWidthMinPixels: 0.8,
      }),
    );
  }

  if (net) {
    const shownLineShapes = net.shapes.filter((sh) => filter.lines.has(sh.shortName));
    layers.push(
      new PathLayer<ShapeLine>({
        id: "routes-glow",
        data: shownLineShapes,
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
        data: shownLineShapes,
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
    );
  }

  // Buses sit beneath rail so trains stay the headline.
  const selectVehicle = (info: PickingInfo<Vehicle>) => {
    onSelect?.(info.object ?? null);
    return true;
  };

  layers.push(
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
      // No position tween: bus membership churns as you pan/zoom, and deck's
      // index-matched transitions would slide dots between unrelated buses.
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
        return [r, g, b, 55];
      },
      transitions: { getPosition: { duration: POSITION_TWEEN_MS } },
    }),
    // Rail vehicles as directional chevrons pointing along their heading.
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
      billboard: false,
      transitions: {
        getPosition: { duration: POSITION_TWEEN_MS },
        getAngle: { duration: 800 },
      },
      onClick: selectVehicle,
    }),
  );

  return (
    <DeckGL
      layers={layers}
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
        object ? { text: `${object.shortName} → ${object.headsign}` } : null
      }
      onClick={(info: PickingInfo) => {
        if (!info.object) onSelect?.(null);
      }}
    />
  );
}
