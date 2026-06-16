"use client";

import { useEffect, useRef, useState } from "react";

import type { Vehicle } from "./transit";

interface Track {
  v: Vehicle;
  fromLon: number;
  fromLat: number;
  toLon: number;
  toLat: number;
  start: number;
}

// Jumps larger than this — catching up after the tab was backgrounded, a trip
// reassignment, or a GPS glitch — snap into place instead of flying across the
// map. Normal updates move a train well under this (~0.5km/refresh).
const SNAP_METERS = 2500;

function metersBetween(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const dLat = (bLat - aLat) * 111_000;
  const dLon = (bLon - aLon) * 111_000 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/**
 * Smoothly interpolate vehicle positions **keyed by tripId** — not by array
 * index, which is what deck.gl's built-in `transitions` use. Index matching
 * cross-animates unrelated vehicles whenever the set changes (a train finishing,
 * a new one starting, or returning to a backgrounded tab), which is what made
 * trains "swap" and fly across the screen.
 *
 * Persistent vehicles glide from their current on-screen spot to the new one;
 * brand-new vehicles appear in place; big jumps snap. Returns a fresh array each
 * animation frame while anything is moving, then goes quiet.
 */
export function useSmoothPositions(target: Vehicle[], durationMs: number): Vehicle[] {
  const tracks = useRef(new Map<string, Track>());
  const rafRef = useRef(0);
  const [frame, setFrame] = useState<Vehicle[]>(target);

  useEffect(() => {
    const now = performance.now();
    const prev = tracks.current;
    const next = new Map<string, Track>();
    for (const v of target) {
      const p = prev.get(v.id);
      // Where this vehicle is being drawn right now (mid-glide if it persisted).
      let curLon = v.lon;
      let curLat = v.lat;
      if (p) {
        const t = Math.min(1, (now - p.start) / durationMs);
        curLon = p.fromLon + (p.toLon - p.fromLon) * t;
        curLat = p.fromLat + (p.toLat - p.fromLat) * t;
      }
      const snap = !p || metersBetween(curLon, curLat, v.lon, v.lat) > SNAP_METERS;
      next.set(v.id, {
        v,
        fromLon: snap ? v.lon : curLon,
        fromLat: snap ? v.lat : curLat,
        toLon: v.lon,
        toLat: v.lat,
        start: now,
      });
    }
    tracks.current = next;

    // One self-terminating rAF chain per target update (cancel any in flight).
    cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const t0 = performance.now();
      let animating = false;
      const out: Vehicle[] = [];
      for (const trk of tracks.current.values()) {
        const moving = trk.fromLon !== trk.toLon || trk.fromLat !== trk.toLat;
        const t = Math.min(1, (t0 - trk.start) / durationMs);
        if (moving && t < 1) animating = true;
        out.push({
          ...trk.v,
          lon: trk.fromLon + (trk.toLon - trk.fromLon) * t,
          lat: trk.fromLat + (trk.toLat - trk.fromLat) * t,
        });
      }
      setFrame(out);
      if (animating) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [target, durationMs]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return frame;
}

/** True while the tab is foregrounded — used to pause polling in the background. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return visible;
}
