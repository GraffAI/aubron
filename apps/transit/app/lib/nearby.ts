// "What can I catch from here": turn a bag of stops around the rider into a
// ranked list of routes, each with the stop they'd actually walk to. Pure, so the
// server route and the client panel can both use it — and so the ranking is
// testable without a browser or a live feed.

import { haversineMeters, type LatLon } from "./geo";
import type { RouteInfo, StopInfo } from "./transit";

/** A stop near the rider, with the routes that serve it (OBA's stops-for-location). */
export interface NearbyStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  routeIds: string[];
  /** Compass direction the stop serves ("N", "SW"), when the agency publishes it. */
  direction?: string;
}

/** A catchable route: which one, the nearest stop that serves it, and how far. */
export interface NearbyRoute {
  route: RouteInfo;
  nearestStop: NearbyStop;
  distanceMeters: number;
}

/**
 * Routes the rider can reach on foot, nearest first.
 *
 * Two things earn their keep here. One: a route is only as far as its CLOSEST
 * stop, so a line with a dozen stops nearby doesn't get ranked by whichever one
 * OBA happened to list first. Two: routes outside `knownRoutes` are dropped —
 * stops-for-location returns every agency in the region (Metro, CT, PT), and the
 * app can only drill into the Sound Transit catalog it fetched, so listing the
 * rest would offer taps that go nowhere.
 *
 * The list is a flat distance sort, rail and bus mixed: a Link station four
 * minutes away belongs above a bus stop across the street from it only if it
 * genuinely is closer. Grouping is the UI's call.
 */
export function nearbyRoutes(
  stops: NearbyStop[],
  origin: LatLon,
  knownRoutes: Map<string, RouteInfo>,
): NearbyRoute[] {
  const best = new Map<string, NearbyRoute>();
  for (const stop of stops) {
    const distanceMeters = haversineMeters(origin, stop);
    for (const routeId of stop.routeIds) {
      const route = knownRoutes.get(routeId);
      if (!route) continue;
      const cur = best.get(routeId);
      if (!cur || distanceMeters < cur.distanceMeters) {
        best.set(routeId, { route, nearestStop: stop, distanceMeters });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/** The stops on a selected line the rider is closest to, nearest first. */
export function nearestStopsOnLine(
  stops: StopInfo[],
  origin: LatLon,
  limit = 3,
): { stop: StopInfo; distanceMeters: number }[] {
  return stops
    .map((stop) => ({ stop, distanceMeters: haversineMeters(origin, stop) }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, Math.max(0, limit));
}
