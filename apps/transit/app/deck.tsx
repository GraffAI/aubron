"use client";

import DeckGL from "@deck.gl/react";
import type { PickingInfo } from "deck.gl";
import { GeoJsonLayer, MapView, PathLayer, ScatterplotLayer } from "deck.gl";
import { useEffect, useState } from "react";

import { type Basemap, loadBasemap } from "./lib/basemap";
import { COLORS, LINE_COLORS, type RGBA } from "./lib/theme";
import type { NetworkData, ShapeLine, StopInfo, Vehicle } from "./lib/transit";

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
const lineColor = (shortName: string): RGBA => LINE_COLORS[shortName] ?? RAIL_FALLBACK;

interface Props {
  onVehicles?: (v: Vehicle[]) => void;
  onSelect?: (v: Vehicle | null) => void;
}

export function TransitDeck({ onVehicles, onSelect }: Props) {
  const [base, setBase] = useState<Basemap | null>(null);
  const [net, setNet] = useState<NetworkData | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

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
    layers.push(
      // Soft underglow beneath each line.
      new PathLayer<ShapeLine>({
        id: "routes-glow",
        data: net.shapes,
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
        data: net.shapes,
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
        getLineColor: [150, 180, 200, 150],
        lineWidthUnits: "pixels",
        getLineWidth: 1,
      }),
    );
  }

  layers.push(
    new ScatterplotLayer<Vehicle>({
      id: "vehicle-glow",
      data: vehicles,
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
      data: vehicles,
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
      onClick: (info: PickingInfo<Vehicle>) => {
        onSelect?.(info.object ?? null);
        return true;
      },
    }),
  );

  return (
    <DeckGL
      layers={layers}
      views={new MapView({ repeat: false })}
      initialViewState={INITIAL_VIEW_STATE}
      controller={{ dragRotate: false }}
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
