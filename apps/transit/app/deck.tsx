"use client";

import DeckGL from "@deck.gl/react";
import type { PickingInfo } from "deck.gl";
import { GeoJsonLayer, MapView, PathLayer, ScatterplotLayer, WebMercatorViewport } from "deck.gl";
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
          onVehicles?.(sorted);
        }
      } catch {
        /* keep last good positions */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 15000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [onVehicles]);

  // Viewport buses — only while the Buses filter is on.
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
      const next = [...(j.vehicles ?? [])].sort((a, b2) => (a.id < b2.id ? -1 : 1));
      setBuses(next);
      onBuses?.(next);
    } catch {
      /* keep last */
    }
  }, [onBuses]);

  useEffect(() => {
    if (!filter.buses) {
      setBuses([]);
      onBuses?.([]);
      return;
    }
    void fetchBuses();
    const id = setInterval(() => void fetchBuses(), 20000);
    return () => clearInterval(id);
  }, [filter.buses, fetchBuses, onBuses]);

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
      getFillColor: BUS_COLOR,
      stroked: false,
      transitions: { getPosition: { duration: 18000 } },
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
      transitions: { getPosition: { duration: 14000 } },
    }),
    new ScatterplotLayer<Vehicle>({
      id: "vehicles",
      data: railShown,
      pickable: true,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 4.2,
      radiusUnits: "pixels",
      radiusMinPixels: 3,
      getFillColor: (d) => lineColor(d.shortName),
      stroked: true,
      getLineColor: [240, 246, 252, 220],
      lineWidthUnits: "pixels",
      getLineWidth: 1.2,
      transitions: { getPosition: { duration: 14000 } },
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
