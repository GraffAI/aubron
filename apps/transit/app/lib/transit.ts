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
  /**
   * The underlying queryable platform stop ids this station was deduped from
   * (OBA's parent station returns no arrivals; its child platforms do). The board
   * queries all of them so it shows every train that visits, both directions.
   * Absent/[id] for a plain stop.
   */
  stopIds?: string[];
}

/** Mostly-static network geometry: what the lines and stops are + where. */
export interface NetworkData {
  routes: RouteInfo[];
  shapes: ShapeLine[];
  stops: StopInfo[];
  /** Catalog of Sound Transit Express bus routes — selectable, geometry on demand. */
  busRoutes: RouteInfo[];
}

/** A single route's geometry, fetched on demand when a bus line is drilled into. */
export interface RouteGeometry {
  routeId: string;
  shortName: string;
  shapes: ShapeLine[];
  stops: StopInfo[];
}

/** A line the rider has drilled into: its geometry, drawn prominently + isolated. */
export interface SelectedLine {
  routeId: string;
  shortName: string;
  mode: Mode;
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
  /** Live passenger count / capacity, when the agency reports them. */
  occupancyCount?: number;
  occupancyCapacity?: number;
  /** Seconds since the last GPS fix (for fading stale vehicles). */
  gpsAgeSec?: number;
  predicted: boolean;
  headsign: string;
  /** False for schedule-only "ghost" trains running with no live GPS fix. */
  hasGps: boolean;
  /** Meters along the trip shape (OBA distanceAlongTrip); −1/absent when no GPS. */
  distanceAlongTrip?: number;
  /** Next stop position + ETA, for schedule-paced forward prediction. */
  nextStopLon?: number;
  nextStopLat?: number;
  /** Seconds until the next stop (OBA nextStopTimeOffset). */
  nextStopTimeOffset?: number;
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

/** One upcoming arrival at a selected stop, for the station signage. */
export interface StopArrival {
  tripId: string;
  routeId: string;
  shortName: string;
  mode: Mode;
  headsign: string;
  /** Predicted arrival epoch ms (falls back to scheduled when not predicted). */
  arrival: number;
  /** Whole minutes until arrival (can be negative if due/passed). */
  minutesAway: number;
  /** Schedule deviation in seconds: + = late, − = early. */
  deviation: number;
  predicted: boolean;
  /** How many stops away the vehicle is right now (0 = at this stop). */
  stopsAway: number;
  /** Live vehicle position, when reported — lets the map frame it with the stop. */
  vehicleLon?: number;
  vehicleLat?: number;
}

/** A selected stop's live board: name, position, and the next arrivals. */
export interface StopBoard {
  stopId: string;
  name: string;
  lon: number;
  lat: number;
  arrivals: StopArrival[];
}

/** Signage status for an arrival, in the spirit of a departure board. */
export type ArrivalState = "arrived" | "arriving" | "due" | "soon" | "scheduled";

/** Coarse status word + how many minutes to show (null when it's a word, not a count). */
export function arrivalState(a: StopArrival): { state: ArrivalState; minutes: number | null } {
  if (a.stopsAway <= 0 && a.minutesAway <= 0) return { state: "arrived", minutes: null };
  if (a.minutesAway <= 0) return { state: "arriving", minutes: null };
  if (a.minutesAway === 1) return { state: "due", minutes: 1 };
  if (!a.predicted) return { state: "scheduled", minutes: a.minutesAway };
  return { state: "soon", minutes: a.minutesAway };
}

/** UI filter state: which rail lines show, whether buses show, on-time-only. */
export interface Filter {
  lines: Set<string>;
  buses: boolean;
  onTimeOnly: boolean;
  /** Debug overlay: expose the raw fix / snap / target behind each train. */
  debug: boolean;
}

export const isOnTime = (deviationSec: number): boolean => Math.abs(deviationSec) < 60;

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
