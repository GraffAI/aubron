"use client";

// The rider's own position, on their terms. Nothing here runs until a user
// gesture calls start() — the one exception being a silent resume when the
// browser already reports the permission as granted AND the rider left the
// feature switched on, which is a preference we stored, not a new prompt.

import { useCallback, useEffect, useRef, useState } from "react";

import { haversineMeters } from "./geo";

export type GeoState = "idle" | "prompting" | "active" | "denied" | "unavailable" | "error";

export interface GeoPosition {
  lat: number;
  lon: number;
  /** Reported accuracy radius in meters. */
  accuracy: number;
}

export interface Geolocation {
  state: GeoState;
  position: GeoPosition | null;
  start: () => void;
  stop: () => void;
}

const STORAGE_KEY = "transit:geo";

// GPS jitters by several meters while standing still, and every published
// position re-runs the nearby fetch downstream. Only publish a move worth
// reacting to — or a fix that's meaningfully more precise than the last one.
const MOVE_THRESHOLD_M = 25;
const ACCURACY_GAIN = 0.6;

const OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 30_000,
  timeout: 15_000,
};

function remember(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode / storage disabled — the feature just won't auto-resume */
  }
}

function wasEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function useGeolocation(): Geolocation {
  const [state, setState] = useState<GeoState>("idle");
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const watchId = useRef<number | null>(null);
  const lastRef = useRef<GeoPosition | null>(null);

  const stop = useCallback(() => {
    if (watchId.current != null && typeof navigator !== "undefined") {
      navigator.geolocation?.clearWatch(watchId.current);
    }
    watchId.current = null;
    lastRef.current = null;
    setPosition(null);
    setState("idle");
    remember(false);
  }, []);

  const begin = useCallback((persist: boolean) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("unavailable");
      return;
    }
    if (watchId.current != null) return;
    setState("prompting");
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const next: GeoPosition = {
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          accuracy: p.coords.accuracy,
        };
        setState("active");
        if (persist) remember(true);
        const last = lastRef.current;
        const moved = !last || haversineMeters(last, next) > MOVE_THRESHOLD_M;
        const sharper = !!last && next.accuracy < last.accuracy * ACCURACY_GAIN;
        if (!moved && !sharper) return;
        lastRef.current = next;
        setPosition(next);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
          watchId.current = null;
          lastRef.current = null;
          setPosition(null);
          setState("denied");
          remember(false);
          return;
        }
        // Unavailable/timeout: the watch stays live and may still recover, so
        // hold on to the last known fix rather than blanking the map.
        setState("error");
      },
      OPTIONS,
    );
  }, []);

  const start = useCallback(() => begin(true), [begin]);

  // Silent resume: only when the rider previously opted in and the browser
  // already holds the grant, so nothing here can raise a prompt on load.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    if (!wasEnabled()) return;
    let cancelled = false;
    void navigator.permissions
      ?.query({ name: "geolocation" as PermissionName })
      .then((status) => {
        if (!cancelled && status.state === "granted") begin(false);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [begin]);

  // Never leave a watch running behind an unmounted map.
  useEffect(() => {
    return () => {
      if (watchId.current != null && typeof navigator !== "undefined") {
        navigator.geolocation?.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, []);

  return { state, position, start, stop };
}
