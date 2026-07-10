// Route geometry as a 1-D track: lets us snap a GPS fix onto the rails and move
// a train ALONG the line (by meters), instead of straight-lining across curves.
//
// OBA hands back several overlapping polylines per route (directions/patterns)
// whose lengths don't line up with the feed's distanceAlongTrip, so we don't try
// to map that global distance onto our geometry. Instead we snap each fix to the
// nearest point on any of the route's shapes and advance locally — robust to the
// overlap, and exact enough over a single prediction horizon.

import type { NetworkData } from "./transit";

export interface Cursor {
  /** Which shape (polyline) of the route this position sits on. */
  shape: number;
  /** Distance in meters from the shape's start. */
  dist: number;
}

interface Shape {
  pts: [number, number][];
  /** Cumulative meters at each vertex; cum[i] is the distance to pts[i]. */
  cum: number[];
  len: number;
}

const DEG = Math.PI / 180;

function segMeters(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const dLat = (bLat - aLat) * 111_000;
  const dLon = (bLon - aLon) * 111_000 * Math.cos(aLat * DEG);
  return Math.hypot(dLat, dLon);
}

/** Compass bearing a→b in degrees (0 = north, clockwise). */
export function bearing(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const e = (bLon - aLon) * Math.cos(aLat * DEG);
  const n = bLat - aLat;
  return (Math.atan2(e, n) / DEG + 360) % 360;
}

/** Project P onto segment A→B; returns fraction t∈[0,1] and a comparable distance². */
function projectToSeg(
  lon: number,
  lat: number,
  a: [number, number],
  b: [number, number],
): { t: number; d2: number } {
  const cosL = Math.cos(lat * DEG);
  const ax = a[0] * cosL,
    ay = a[1],
    bx = b[0] * cosL,
    by = b[1];
  const px = lon * cosL,
    py = lat;
  const dx = bx - ax,
    dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t,
    qy = ay + dy * t;
  return { t, d2: (px - qx) ** 2 + (py - qy) ** 2 };
}

export class TrackIndex {
  private routes = new Map<string, Shape[]>();

  constructor(net: NetworkData) {
    for (const sh of net.shapes) {
      if (sh.path.length < 2) continue;
      const cum = [0];
      for (let i = 1; i < sh.path.length; i++) {
        const a = sh.path[i - 1]!;
        const b = sh.path[i]!;
        cum.push(cum[i - 1]! + segMeters(a[0], a[1], b[0], b[1]));
      }
      const shape: Shape = { pts: sh.path, cum, len: cum[cum.length - 1]! };
      const arr = this.routes.get(sh.routeId);
      if (arr) arr.push(shape);
      else this.routes.set(sh.routeId, [shape]);
    }
  }

  has(routeId: string): boolean {
    return this.routes.has(routeId);
  }

  len(routeId: string, shape: number): number {
    return this.routes.get(routeId)?.[shape]?.len ?? 0;
  }

  /** Nearest point on any of the route's shapes. */
  snap(routeId: string, lon: number, lat: number): Cursor | null {
    const shapes = this.routes.get(routeId);
    if (!shapes) return null;
    let best: Cursor | null = null;
    let bestD2 = Infinity;
    for (let si = 0; si < shapes.length; si++) {
      const s = shapes[si]!;
      for (let i = 1; i < s.pts.length; i++) {
        const { t, d2 } = projectToSeg(lon, lat, s.pts[i - 1]!, s.pts[i]!);
        if (d2 < bestD2) {
          bestD2 = d2;
          best = { shape: si, dist: s.cum[i - 1]! + t * (s.cum[i]! - s.cum[i - 1]!) };
        }
      }
    }
    return best;
  }

  /** Nearest distance on one specific shape (keeps a glide on the same polyline). */
  snapToShape(routeId: string, shape: number, lon: number, lat: number): number | null {
    const s = this.routes.get(routeId)?.[shape];
    if (!s) return null;
    let bestDist = 0;
    let bestD2 = Infinity;
    for (let i = 1; i < s.pts.length; i++) {
      const { t, d2 } = projectToSeg(lon, lat, s.pts[i - 1]!, s.pts[i]!);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestDist = s.cum[i - 1]! + t * (s.cum[i]! - s.cum[i - 1]!);
      }
    }
    return bestD2 === Infinity ? null : bestDist;
  }

  /** Position [lon, lat] at a cursor. */
  pointAt(routeId: string, c: Cursor): [number, number] {
    const s = this.routes.get(routeId)?.[c.shape];
    if (!s) return [0, 0];
    const d = Math.max(0, Math.min(s.len, c.dist));
    let i = 1;
    while (i < s.cum.length - 1 && s.cum[i]! < d) i++;
    const a = s.pts[i - 1]!;
    const b = s.pts[i]!;
    const seg = s.cum[i]! - s.cum[i - 1]! || 1;
    const t = (d - s.cum[i - 1]!) / seg;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  /**
   * The shape's geometry between two distances, ordered a → b (reversed when
   * a > b), endpoints interpolated. Lets the debug overlay draw a glide as the
   * arc it actually follows along the rails instead of a straight chord.
   */
  pathBetween(routeId: string, shape: number, a: number, b: number): [number, number][] {
    const s = this.routes.get(routeId)?.[shape];
    if (!s) return [];
    const lo = Math.max(0, Math.min(s.len, Math.min(a, b)));
    const hi = Math.max(0, Math.min(s.len, Math.max(a, b)));
    const pts: [number, number][] = [this.pointAt(routeId, { shape, dist: lo })];
    for (let i = 0; i < s.cum.length; i++) {
      if (s.cum[i]! > lo && s.cum[i]! < hi) pts.push(s.pts[i]!);
    }
    pts.push(this.pointAt(routeId, { shape, dist: hi }));
    if (a > b) pts.reverse();
    return pts;
  }

  /** Heading of the track at a cursor (0 = north, clockwise). */
  bearingAt(routeId: string, c: Cursor): number {
    const s = this.routes.get(routeId)?.[c.shape];
    if (!s) return 0;
    let i = 1;
    while (i < s.pts.length - 1 && s.cum[i]! < c.dist) i++;
    const a = s.pts[i - 1]!;
    const b = s.pts[i]!;
    return bearing(a[0], a[1], b[0], b[1]);
  }
}
