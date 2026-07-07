"use client";

import { useEffect, useRef, useState } from "react";

import { bearing, type TrackIndex } from "./track";
import type { Vehicle } from "./transit";

// A glide either runs ALONG a route's track (rail, by meters on a shape) or, when
// we have no track for the route (buses), straight-line between two points.
interface TrackGlide {
  kind: "track";
  v: Vehicle;
  routeId: string;
  shape: number;
  /** Where the latest fix snapped onto the track (the basis for this glide). */
  anchorDist: number;
  fromDist: number;
  toDist: number;
  /** Direction of travel along the shape (+1 increasing distance, −1 decreasing). */
  dir: number;
  start: number;
}

/** Per-train geometry for the debug overlay (only attached when `debug` is on). */
export interface Debug {
  /** Last raw GPS fix from the feed. */
  rawLon: number;
  rawLat: number;
  /** That fix snapped onto the track. */
  anchorLon: number;
  anchorLat: number;
  /** Where the glide is carrying the train this cycle (the prediction). */
  targetLon: number;
  targetLat: number;
  /** Measured speed (m/s) and age of the fix (s). */
  speed: number;
  gpsAgeSec?: number;
}

/** A smoothed vehicle, optionally carrying the interpolation's debug geometry. */
export interface SmoothVehicle extends Vehicle {
  debug?: Debug;
}
interface LineGlide {
  kind: "line";
  v: Vehicle;
  fromLon: number;
  fromLat: number;
  toLon: number;
  toLat: number;
  start: number;
}
type Glide = TrackGlide | LineGlide;

// Last confirmed fix per trip, so we can measure how fast it's actually moving.
export interface Motion {
  lon: number;
  lat: number;
  /** Wall time we observed this fix (fallback clock when the feed omits fixTime). */
  time: number;
  /** Feed timestamp of the fix (lastLocationUpdateTime) — the accurate dt basis. */
  fixTime?: number;
  speed: number; // m/s, from the last two distinct fixes
  heading: number; // degrees, direction of travel (NaN until we've seen movement)
}

// Jumps larger than this — catching up after a backgrounded tab, a trip
// reassignment, or a GPS glitch — snap into place instead of sliding across.
const SNAP_METERS = 2500;
// Below this we treat the train as stopped/dwelling and never predict it forward
// (so it can't be shown leaving a platform it hasn't left).
const MOVING_MIN_MPS = 2;
// A new fix has to move this far to count as motion (filters GPS jitter at rest).
const FIX_EPS_METERS = 15;
// How far ahead of the last fix we predict. Measured against the live feed
// (2026-07): fixes refresh every ~20s median (p90 35s) and are already ~16s old
// when first observed; a 15s horizon nearly halved the median draw error vs raw
// fixes (213m → 119m) without letting a stalled feed run a dot off the end.
const HORIZON_SEC = 15;
// Absolute ceiling on a single prediction, regardless of speed.
const MAX_PREDICT_METERS = 1200;
// Faster than any train here (Sounder tops out ~36 m/s). A measured speed above
// this is a feed glitch or a trip re-seat teleport (observed p99 was 78 m/s on
// exactly such glitches) — re-seed motion instead of predicting with poison.
const MAX_SPEED_MPS = 45;

function metersBetween(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const dLat = (bLat - aLat) * 111_000;
  const dLon = (bLon - aLon) * 111_000 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/**
 * How far along the track to predict this train, in meters. Zero for ghosts,
 * dwelling/stopped trains, and trains we've not yet seen move — those just glide
 * to their reported spot. A moving train is carried forward at its observed speed,
 * but capped by its ETA to the next stop and kept short of that stop, so it paces
 * toward arrival (variable speed) and never fakes a departure.
 */
export function predictMeters(v: Vehicle, m: Motion | undefined): number {
  if (!v.hasGps || !m || Number.isNaN(m.heading) || m.speed < MOVING_MIN_MPS) return 0;
  let pace = m.speed;
  let cap = MAX_PREDICT_METERS;
  if (
    v.nextStopTimeOffset &&
    v.nextStopTimeOffset > 0 &&
    v.nextStopLon != null &&
    v.nextStopLat != null
  ) {
    const toNext = metersBetween(v.lon, v.lat, v.nextStopLon, v.nextStopLat);
    pace = Math.min(pace, toNext / v.nextStopTimeOffset); // don't outrun the ETA
    cap = Math.min(cap, 0.85 * toNext); // stay short of the stop until a fix confirms arrival
  }
  return Math.min(pace * HORIZON_SEC, cap);
}

/**
 * Smoothly interpolate vehicle positions **keyed by tripId** (not array index,
 * which is what deck.gl's built-in transitions use and what made trains swap and
 * fly across the map when the set changed).
 *
 * When a `track` is supplied and covers the route (rail), positions ride the
 * rails: each fix snaps to the nearest point on the line, a moving train is
 * carried forward along the track by its schedule-paced prediction, and the glide
 * runs in meters along the shape — so it follows curves and decelerates into
 * stops instead of straight-lining. Routes with no track (buses) fall back to a
 * straight glide between fixes. Big jumps snap; everything goes quiet when still.
 */
export function useSmoothPositions(
  target: Vehicle[],
  durationMs: number,
  track?: TrackIndex | null,
  debug = false,
): SmoothVehicle[] {
  const glides = useRef(new Map<string, Glide>());
  const motion = useRef(new Map<string, Motion>());
  const rafRef = useRef(0);
  const [frame, setFrame] = useState<SmoothVehicle[]>(target);

  useEffect(() => {
    const now = performance.now();
    const wall = Date.now();
    const prev = glides.current;
    const next = new Map<string, Glide>();

    for (const v of target) {
      const p = prev.get(v.id);

      // Where this vehicle is being drawn right now (mid-glide if it persisted).
      let curLon = v.lon;
      let curLat = v.lat;
      if (p) {
        const t = Math.min(1, (now - p.start) / durationMs);
        if (p.kind === "track" && track) {
          const d = p.fromDist + (p.toDist - p.fromDist) * t;
          [curLon, curLat] = track.pointAt(p.routeId, { shape: p.shape, dist: d });
        } else if (p.kind === "line") {
          curLon = p.fromLon + (p.toLon - p.fromLon) * t;
          curLat = p.fromLat + (p.toLat - p.fromLat) * t;
        }
      }

      // Track the train's real speed/heading from successive distinct fixes.
      // The feed's fixTime (lastLocationUpdateTime) tells a NEW fix apart from
      // the same one re-served — crucial for dwell: a fresh fix that hasn't
      // moved means the train is MEASURED stationary (speed 0), where treating
      // it as "no news" would keep predicting it forward at its old approach
      // speed and drift it off the platform for the whole stop.
      const m = motion.current.get(v.id);
      let mNow: Motion;
      if (!m) {
        mNow = { lon: v.lon, lat: v.lat, time: wall, fixTime: v.fixTime, speed: 0, heading: NaN };
        motion.current.set(v.id, mNow);
      } else {
        const moved = metersBetween(m.lon, m.lat, v.lon, v.lat);
        const newFix =
          v.fixTime != null && m.fixTime != null ? v.fixTime > m.fixTime : moved > FIX_EPS_METERS;
        if (!newFix) {
          mNow = m; // same fix re-served — no new information
        } else {
          // dt between the fixes themselves when the feed stamps them (poll-time
          // gaps overstate dt by up to a poll period and dilute the speed).
          const dt = Math.max(
            1,
            (v.fixTime != null && m.fixTime != null ? v.fixTime - m.fixTime : wall - m.time) / 1000,
          );
          const speed = moved / dt;
          mNow =
            speed > MAX_SPEED_MPS
              ? // Teleport/glitch: position is untrustworthy as a motion basis —
                // re-seed and wait for the next clean pair before predicting.
                { lon: v.lon, lat: v.lat, time: wall, fixTime: v.fixTime, speed: 0, heading: NaN }
              : {
                  lon: v.lon,
                  lat: v.lat,
                  time: wall,
                  fixTime: v.fixTime,
                  speed: moved > FIX_EPS_METERS ? speed : 0,
                  // A stationary fix keeps the approach heading (for the icon);
                  // speed 0 already gates any forward prediction.
                  heading: moved > FIX_EPS_METERS ? bearing(m.lon, m.lat, v.lon, v.lat) : m.heading,
                };
          motion.current.set(v.id, mNow);
        }
      }

      const jump = p ? metersBetween(curLon, curLat, v.lon, v.lat) : Infinity;
      const anchor = track?.snap(v.routeId, v.lon, v.lat);

      if (track && anchor) {
        const shape = anchor.shape;
        const predM = predictMeters(v, mNow);
        // Which way along the shape the train travels — measured heading when we
        // have it, else the feed's reported orientation. Drives both the forward
        // prediction and the icon's facing as it rounds curves.
        const travelHeading = Number.isNaN(mNow.heading) ? v.heading : mNow.heading;
        const tb = track.bearingAt(v.routeId, anchor);
        const diff = Math.abs(((travelHeading - tb + 540) % 360) - 180);
        const dir = diff < 90 ? 1 : -1;
        const len = track.len(v.routeId, shape);
        const toDist = Math.max(0, Math.min(len, anchor.dist + dir * predM));
        // Keep a persisting glide on the same shape; snap on appear/teleport.
        let fromDist = anchor.dist;
        if (p && jump <= SNAP_METERS) {
          fromDist = track.snapToShape(v.routeId, shape, curLon, curLat) ?? anchor.dist;
        }
        next.set(v.id, {
          kind: "track",
          v,
          routeId: v.routeId,
          shape,
          anchorDist: anchor.dist,
          fromDist,
          toDist,
          dir,
          start: now,
        });
      } else {
        const snap = !p || jump > SNAP_METERS;
        next.set(v.id, {
          kind: "line",
          v,
          fromLon: snap ? v.lon : curLon,
          fromLat: snap ? v.lat : curLat,
          toLon: v.lon,
          toLat: v.lat,
          start: now,
        });
      }
    }
    glides.current = next;

    // Drop motion state for trips that have left the set.
    for (const id of motion.current.keys()) {
      if (!next.has(id)) motion.current.delete(id);
    }

    // One self-terminating rAF chain per target update (cancel any in flight).
    cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const t0 = performance.now();
      let animating = false;
      const out: SmoothVehicle[] = [];
      for (const g of glides.current.values()) {
        const t = Math.min(1, (t0 - g.start) / durationMs);
        let lon: number;
        let lat: number;
        let heading = g.v.heading;
        if (g.kind === "track" && track) {
          if (g.fromDist !== g.toDist && t < 1) animating = true;
          const d = g.fromDist + (g.toDist - g.fromDist) * t;
          const cursor = { shape: g.shape, dist: d };
          [lon, lat] = track.pointAt(g.routeId, cursor);
          // Face along the track at the current spot, so the icon rotates through
          // curves instead of holding the last fix's angle for the whole glide.
          heading = (track.bearingAt(g.routeId, cursor) + (g.dir < 0 ? 180 : 0)) % 360;
        } else if (g.kind === "line") {
          if ((g.fromLon !== g.toLon || g.fromLat !== g.toLat) && t < 1) animating = true;
          lon = g.fromLon + (g.toLon - g.fromLon) * t;
          lat = g.fromLat + (g.toLat - g.fromLat) * t;
        } else {
          lon = g.v.lon;
          lat = g.v.lat;
        }

        let dbg: Debug | undefined;
        if (debug) {
          let anchorLon = g.v.lon;
          let anchorLat = g.v.lat;
          let targetLon = lon;
          let targetLat = lat;
          if (g.kind === "track" && track) {
            [anchorLon, anchorLat] = track.pointAt(g.routeId, {
              shape: g.shape,
              dist: g.anchorDist,
            });
            [targetLon, targetLat] = track.pointAt(g.routeId, { shape: g.shape, dist: g.toDist });
          } else if (g.kind === "line") {
            targetLon = g.toLon;
            targetLat = g.toLat;
          }
          dbg = {
            rawLon: g.v.lon,
            rawLat: g.v.lat,
            anchorLon,
            anchorLat,
            targetLon,
            targetLat,
            speed: motion.current.get(g.v.id)?.speed ?? 0,
            gpsAgeSec: g.v.gpsAgeSec,
          };
        }
        out.push({ ...g.v, lon, lat, heading, debug: dbg });
      }
      setFrame(out);
      if (animating) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [target, durationMs, track, debug]);

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
