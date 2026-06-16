"use client";

import DeckGL from "@deck.gl/react";
import { GeoJsonLayer, MapView } from "deck.gl";
import { useEffect, useState } from "react";

import { type Basemap, loadBasemap } from "./lib/basemap";
import { COLORS } from "./lib/theme";

const INITIAL_VIEW_STATE = {
  longitude: -122.33,
  latitude: 47.62,
  zoom: 10.6,
  minZoom: 8,
  maxZoom: 16,
  pitch: 0,
  bearing: 0,
};

export function TransitDeck() {
  const [base, setBase] = useState<Basemap | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    loadBasemap(ctrl.signal)
      .then(setBase)
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) console.error("basemap load failed", err);
      });
    return () => ctrl.abort();
  }, []);

  const layers = base
    ? [
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
          filled: false,
          stroked: true,
          getLineColor: COLORS.road,
          lineWidthUnits: "pixels",
          getLineWidth: 1,
          lineWidthMinPixels: 0.5,
        }),
        new GeoJsonLayer({
          id: "coastline",
          data: base.coastline,
          filled: false,
          stroked: true,
          getLineColor: COLORS.coastline,
          lineWidthUnits: "pixels",
          getLineWidth: 1.1,
          lineWidthMinPixels: 0.8,
        }),
      ]
    : [];

  return (
    <DeckGL
      layers={layers}
      views={new MapView({ repeat: false })}
      initialViewState={INITIAL_VIEW_STATE}
      controller={{ dragRotate: false }}
      style={{ position: "absolute", inset: "0" }}
    />
  );
}
