// Turning geometry into camera targets: take a set of paths or points and work
// out the {longitude, latitude, zoom} that frames them in the current canvas, so
// deck.gl can fly there. Kept apart from the layer code so the math is testable.

import { WebMercatorViewport } from "deck.gl";

export interface Bounds {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface ViewTarget {
  longitude: number;
  latitude: number;
  zoom: number;
}

/** Screen-space breathing room kept on each side when framing (e.g. for panels). */
export interface Padding {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

/** A camera request: where to frame + a nonce so repeats still re-trigger the fly. */
export interface Focus {
  bounds: Bounds;
  nonce: number;
  padding?: number | Padding;
  maxZoom?: number;
}

const merge = (a: Bounds | null, lon: number, lat: number): Bounds =>
  a
    ? {
        minLng: Math.min(a.minLng, lon),
        minLat: Math.min(a.minLat, lat),
        maxLng: Math.max(a.maxLng, lon),
        maxLat: Math.max(a.maxLat, lat),
      }
    : { minLng: lon, minLat: lat, maxLng: lon, maxLat: lat };

export function boundsOfPoints(points: [number, number][]): Bounds | null {
  let b: Bounds | null = null;
  for (const [lon, lat] of points) b = merge(b, lon, lat);
  return b;
}

export function boundsOfPaths(paths: [number, number][][]): Bounds | null {
  let b: Bounds | null = null;
  for (const path of paths) for (const [lon, lat] of path) b = merge(b, lon, lat);
  return b;
}

/** Grow a (possibly zero-area) box outward by a fraction of its span, with a floor. */
export function padBounds(b: Bounds, frac = 0.15, minDeg = 0.004): Bounds {
  const dLng = Math.max((b.maxLng - b.minLng) * frac, minDeg);
  const dLat = Math.max((b.maxLat - b.minLat) * frac, minDeg);
  return {
    minLng: b.minLng - dLng,
    minLat: b.minLat - dLat,
    maxLng: b.maxLng + dLng,
    maxLat: b.maxLat + dLat,
  };
}

/**
 * The view that frames `bounds` in a width×height canvas. `padding` is screen
 * pixels kept clear on each side (e.g. for the side panel); `maxZoom` keeps a
 * single stop from zooming absurdly far in.
 */
export function fitBounds(
  bounds: Bounds,
  width: number,
  height: number,
  { padding = 80, maxZoom = 15 }: { padding?: number | Padding; maxZoom?: number } = {},
): ViewTarget {
  const vp = new WebMercatorViewport({ width: Math.max(1, width), height: Math.max(1, height) });
  const { longitude, latitude, zoom } = vp.fitBounds(
    [
      [bounds.minLng, bounds.minLat],
      [bounds.maxLng, bounds.maxLat],
    ],
    { padding },
  );
  return { longitude, latitude, zoom: Math.min(zoom, maxZoom) };
}
