// Shared transit domain types + helpers, safe on client and server.

export type Mode = "light-rail" | "rail" | "bus";

/** A transit route (rail only, for now). */
export interface RouteInfo {
  id: string;
  shortName: string;
  longName: string;
  mode: Mode;
}

/** One drawn segment of a route's shape, as [lon, lat] pairs for deck.gl. */
export interface ShapeLine {
  routeId: string;
  shortName: string;
  path: [number, number][];
}

export interface StopInfo {
  id: string;
  name: string;
  lon: number;
  lat: number;
}

/** Mostly-static network geometry: what the lines and stops are + where. */
export interface NetworkData {
  routes: RouteInfo[];
  shapes: ShapeLine[];
  stops: StopInfo[];
}

/** A live vehicle position from the realtime feed. */
export interface Vehicle {
  id: string;
  tripId: string;
  routeId: string;
  shortName: string;
  mode: Mode;
  lon: number;
  lat: number;
  /** Heading in degrees, 0 = north, clockwise (converted from OBA's frame). */
  heading: number;
  /** Schedule deviation in seconds: + = late, − = early. */
  deviation: number;
  occupancy: string;
  predicted: boolean;
  headsign: string;
}

/** One upcoming stop on a selected trip, with its predicted arrival. */
export interface TripStop {
  stopId: string;
  name: string;
  /** Scheduled arrival, epoch ms. */
  scheduled: number;
  /** Predicted arrival (scheduled + live deviation), epoch ms. */
  predicted: number;
  /** Whole minutes until predicted arrival (can be negative if due/passed). */
  minutesAway: number;
  /** True for the train's immediate next stop. */
  isNext: boolean;
}

/** A selected trip's live deviation + ordered upcoming stops. */
export interface TripDetail {
  tripId: string;
  deviation: number;
  stops: TripStop[];
}

/** GTFS route_type → our coarse mode. 0 = tram/light rail/streetcar, 2 = rail. */
export function modeFromType(type: number): Mode {
  if (type === 0) return "light-rail";
  if (type === 2) return "rail";
  return "bus";
}

export const isRailType = (type: number): boolean => type === 0 || type === 2;

/**
 * OBA `orientation` is degrees counterclockwise from east (0 = east, 90 = north).
 * Convert to compass heading (0 = north, clockwise) for display.
 */
export function orientationToHeading(orientation: number): number {
  return (90 - orientation + 360) % 360;
}

/**
 * Decode a Google-encoded polyline (precision 5) to [lon, lat] pairs (deck.gl
 * order). OBA returns route shapes in this format.
 */
export function decodePolyline(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
}
