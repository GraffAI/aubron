// Server-only OneBusAway client. The API key lives in process.env and never
// reaches the browser — the client talks to our /api/* route handlers, which
// call these functions.

import {
  decodePolyline,
  isRailType,
  modeFromType,
  orientationToHeading,
  type NetworkData,
  type RouteInfo,
  type ShapeLine,
  type StopInfo,
  type TripDetail,
  type TripStop,
  type Vehicle,
} from "./transit";

const BASE = "https://api.pugetsound.onebusaway.org/api/where";
const AGENCY = "40"; // Sound Transit — runs all the rail (Link, T Line, Sounder).

interface ObaEnvelope<T> {
  code: number;
  data: T;
}

interface ObaRoute {
  id: string;
  shortName?: string;
  longName?: string;
  type: number;
}

interface ObaStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

function key(): string {
  const k = process.env.OBA_API_KEY;
  if (!k) throw new Error("OBA_API_KEY is not set");
  return k;
}

async function obaGet<T>(
  path: string,
  params: Record<string, string> = {},
  revalidate = 0,
): Promise<T> {
  const qs = new URLSearchParams({ key: key(), ...params });
  const url = `${BASE}/${path}.json?${qs}`;
  // OBA occasionally 502/429s under bursts of concurrent calls — retry a couple
  // of times with light backoff before giving up.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        next: revalidate > 0 ? { revalidate } : undefined,
        cache: revalidate > 0 ? undefined : "no-store",
      });
      if (!res.ok) throw new Error(`OBA ${path} → ${res.status}`);
      const body = (await res.json()) as ObaEnvelope<T>;
      return body.data;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/** Sound Transit's rail routes (light rail + commuter rail; shuttles are buses). */
async function getRailRoutes(): Promise<RouteInfo[]> {
  const data = await obaGet<{ list: ObaRoute[] }>(`routes-for-agency/${AGENCY}`, {}, 60 * 60 * 24);
  return data.list
    .filter((r) => isRailType(r.type))
    .map((r) => ({
      id: r.id,
      shortName: r.shortName ?? r.id,
      longName: r.longName ?? "",
      mode: modeFromType(r.type),
    }));
}

/** Route shapes (decoded polylines) + stops for every rail route. */
export async function getNetwork(): Promise<NetworkData> {
  const routes = await getRailRoutes();
  const shapes: ShapeLine[] = [];
  const stopsById = new Map<string, StopInfo>();

  await Promise.all(
    routes.map(async (route) => {
      let data;
      try {
        data = await obaGet<{
          entry: { polylines?: { points: string }[] };
          references: { stops: ObaStop[] };
        }>(`stops-for-route/${route.id}`, { includePolylines: "true" }, 60 * 60 * 24);
      } catch (err) {
        console.error(`stops-for-route ${route.id} failed`, err);
        return;
      }

      for (const pl of data.entry.polylines ?? []) {
        const path = decodePolyline(pl.points);
        if (path.length > 1) shapes.push({ routeId: route.id, shortName: route.shortName, path });
      }
      for (const s of data.references.stops) {
        if (!stopsById.has(s.id)) {
          stopsById.set(s.id, { id: s.id, name: s.name, lon: s.lon, lat: s.lat });
        }
      }
    }),
  );

  return { routes, shapes, stops: [...stopsById.values()] };
}

interface ObaTrip {
  tripId: string;
  status?: {
    position?: { lat: number; lon: number };
    lastKnownLocation?: { lat: number; lon: number };
    orientation?: number;
    scheduleDeviation?: number;
    occupancyStatus?: string;
    occupancyCount?: number;
    occupancyCapacity?: number;
    lastLocationUpdateTime?: number;
    predicted?: boolean;
    /** Meters along the trip shape; −1 when there's no live GPS fix. */
    distanceAlongTrip?: number;
    nextStop?: string;
    nextStopTimeOffset?: number;
    closestStop?: string;
    closestStopTimeOffset?: number;
    /** "in_progress" once the trip is actually running. */
    phase?: string;
  };
}

interface ObaTripRef {
  id: string;
  routeId?: string;
  tripHeadsign?: string;
}

interface TripsResponse {
  list: ObaTrip[];
  references: { trips: ObaTripRef[]; routes: ObaRoute[]; stops: ObaStop[] };
}

/**
 * Position a schedule-only "ghost" (no live GPS) between the stop it's nearest to
 * and the one it's heading for, by the ratio of their time offsets. Approximate —
 * the client snaps it to the rails — but it creeps along as the offsets tick down.
 */
function ghostPosition(
  closest: ObaStop | undefined,
  next: ObaStop | undefined,
  closestOff: number | undefined,
  nextOff: number | undefined,
): { lon: number; lat: number } | null {
  if (closest && next && closest.id !== next.id && closestOff != null && nextOff != null) {
    const behind = Math.max(0, -closestOff); // seconds since the closest stop, if passed
    const ahead = Math.max(0, nextOff);
    const span = behind + ahead;
    const f = span > 0 ? Math.min(1, behind / span) : 0;
    return {
      lon: closest.lon + (next.lon - closest.lon) * f,
      lat: closest.lat + (next.lat - closest.lat) * f,
    };
  }
  const s = next ?? closest;
  return s ? { lon: s.lon, lat: s.lat } : null;
}

/**
 * Build a Vehicle from a trip using its TRUE route (from references), not the
 * route we happened to query — trips-for-route mixes in trains from other routes
 * that share track (e.g. a 1 Line train shows up under the 2 Line query). `now`
 * is the server clock for an accurate GPS-age. Rail trips that are in progress but
 * have no live GPS are kept as schedule-only "ghosts" (positioned from their stops).
 */
function toVehicle(
  trip: ObaTrip,
  route: ObaRoute,
  headsign: string,
  now: number,
  stops: Map<string, ObaStop>,
): Vehicle | null {
  const s = trip.status;
  const dat = s?.distanceAlongTrip;
  const livePos = s?.position ?? s?.lastKnownLocation;
  const hasGps =
    !!livePos && !(livePos.lat === 0 && livePos.lon === 0) && (dat == null || dat >= 0);
  const nextStop = s?.nextStop ? stops.get(s.nextStop) : undefined;

  let lon: number;
  let lat: number;
  if (hasGps) {
    lon = livePos!.lon;
    lat = livePos!.lat;
  } else {
    // Only place ghosts for rail trips actually underway — never buses, never
    // not-yet-started or finished trips.
    if (!isRailType(route.type) || s?.phase !== "in_progress") return null;
    const closest = s?.closestStop ? stops.get(s.closestStop) : undefined;
    const ghost = ghostPosition(closest, nextStop, s?.closestStopTimeOffset, s?.nextStopTimeOffset);
    if (!ghost) return null;
    lon = ghost.lon;
    lat = ghost.lat;
  }

  const updated = s?.lastLocationUpdateTime;
  return {
    id: trip.tripId,
    tripId: trip.tripId,
    routeId: route.id,
    shortName: route.shortName ?? route.id,
    mode: modeFromType(route.type),
    lon,
    lat,
    heading: orientationToHeading(s?.orientation ?? 0),
    deviation: s?.scheduleDeviation ?? 0,
    occupancy: s?.occupancyStatus ?? "",
    occupancyCount: s?.occupancyCount,
    occupancyCapacity: s?.occupancyCapacity,
    gpsAgeSec: hasGps && updated ? Math.max(0, Math.round((now - updated) / 1000)) : undefined,
    predicted: s?.predicted ?? false,
    headsign: headsign || route.longName || "",
    hasGps,
    distanceAlongTrip: dat,
    nextStopLon: nextStop?.lon,
    nextStopLat: nextStop?.lat,
    nextStopTimeOffset: s?.nextStopTimeOffset,
  };
}

/**
 * Collect vehicles from a set of trips-for-route queries into a tripId-keyed map,
 * labelling each by its real route and keeping only routes that pass `keepRoute`.
 * Deduping by tripId means a train returned under several route queries lands once.
 */
async function collectVehicles(
  routeIds: string[],
  keepRoute: (r: ObaRoute) => boolean,
): Promise<Map<string, Vehicle>> {
  const byTrip = new Map<string, Vehicle>();
  await Promise.all(
    routeIds.map(async (routeId) => {
      let data: TripsResponse;
      try {
        data = await obaGet<TripsResponse>(`trips-for-route/${routeId}`, {
          includeStatus: "true",
          includeSchedule: "false",
        });
      } catch (err) {
        console.error(`trips-for-route ${routeId} failed`, err);
        return;
      }
      const now = Date.now();
      const trips = new Map(data.references.trips.map((t) => [t.id, t]));
      const routes = new Map(data.references.routes.map((r) => [r.id, r]));
      const stops = new Map((data.references.stops ?? []).map((s) => [s.id, s]));
      for (const trip of data.list) {
        const ref = trips.get(trip.tripId);
        const route = ref?.routeId ? routes.get(ref.routeId) : undefined;
        if (!route || !keepRoute(route)) continue;
        const v = toVehicle(trip, route, ref?.tripHeadsign ?? "", now, stops);
        if (v) byTrip.set(trip.tripId, v);
      }
    }),
  );
  return byTrip;
}

/** Live vehicle positions across all rail routes. */
export async function getVehicles(): Promise<Vehicle[]> {
  const routes = await getRailRoutes();
  const byTrip = await collectVehicles(
    routes.map((r) => r.id),
    (r) => isRailType(r.type),
  );
  return [...byTrip.values()];
}

interface ObaTripDetails {
  entry: {
    serviceDate: number;
    status?: { scheduleDeviation?: number; nextStop?: string };
    schedule?: { stopTimes?: { stopId: string; arrivalTime: number }[] };
  };
  references: { stops: ObaStop[] };
}

// stopTimes use platform ids (40_N23-T2); references use the parent (40_N23).
const stripPlatform = (id: string): string => id.replace(/-T\d+$/, "");

/** Ordered upcoming stops + predicted ETAs for one trip. */
export async function getTripDetail(tripId: string): Promise<TripDetail> {
  const data = await obaGet<ObaTripDetails>(`trip-details/${encodeURIComponent(tripId)}`);
  const { entry, references } = data;
  const serviceDate = entry.serviceDate;
  const deviation = entry.status?.scheduleDeviation ?? 0;
  const nextStop = entry.status?.nextStop ?? "";
  const now = Date.now();

  const stops = new Map(references.stops.map((s) => [s.id, s]));
  const nameOf = (id: string): string =>
    (stops.get(id) ?? stops.get(stripPlatform(id)))?.name ?? id;

  const all: TripStop[] = (entry.schedule?.stopTimes ?? []).map((st) => {
    const scheduled = serviceDate + st.arrivalTime * 1000;
    const predicted = scheduled + deviation * 1000;
    return {
      stopId: st.stopId,
      name: nameOf(st.stopId),
      scheduled,
      predicted,
      minutesAway: Math.round((predicted - now) / 60000),
      isNext: false,
    };
  });

  // Show from the train's next stop onward (fall back to the first not-yet-passed).
  let start = nextStop
    ? all.findIndex((s) => stripPlatform(s.stopId) === stripPlatform(nextStop))
    : -1;
  if (start < 0) start = all.findIndex((s) => s.predicted > now - 60_000);
  if (start < 0) start = all.length;

  const upcoming = all.slice(start);
  if (upcoming[0]) upcoming[0].isNext = true;
  return { tripId, deviation, stops: upcoming };
}

/**
 * Buses visible in a viewport. trips-for-location is disabled on this server, so
 * we discover routes in the box (routes-for-location, cached) and pull live
 * positions per bus route. Capped to keep the call volume sane.
 */
export async function getAreaBuses(
  lat: number,
  lon: number,
  latSpan: number,
  lonSpan: number,
): Promise<Vehicle[]> {
  const area = await obaGet<{ list: ObaRoute[] }>(
    "routes-for-location",
    {
      lat: String(lat),
      lon: String(lon),
      latSpan: String(latSpan),
      lonSpan: String(lonSpan),
    },
    300,
  );
  const busRouteIds = area.list
    .filter((r) => r.type === 3)
    .slice(0, 25)
    .map((r) => r.id);
  const latPad = latSpan / 2 + 0.01;
  const lonPad = lonSpan / 2 + 0.01;

  // Label by true route + dedupe, then keep only buses actually inside the box.
  const byTrip = await collectVehicles(busRouteIds, (r) => r.type === 3);
  return [...byTrip.values()].filter(
    (v) => Math.abs(v.lat - lat) <= latPad && Math.abs(v.lon - lon) <= lonPad,
  );
}
