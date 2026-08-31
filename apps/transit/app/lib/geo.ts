// Distance and walk-time math for "how far is that from me". The rest of the app
// gets away with flat-earth approximations over a few hundred meters; a rider
// staring at "6 min walk" deserves the real great-circle number, so this one is
// exact (and shared by the hook, the panel and the nearby aggregation).

const R = 6_371_008.8; // IUGG mean Earth radius, meters
const DEG = Math.PI / 180;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Great-circle distance in meters between two points. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const la1 = a.lat * DEG;
  const la2 = b.lat * DEG;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// A brisk-ish city pace, ~4.8 km/h — the number transit apps quote. Rounded up:
// no one arrives in "half a minute", and under-promising a walk is the wrong way
// to be wrong when a train is leaving.
const METERS_PER_MINUTE = 80;

/** Walking minutes for a distance, rounded up, never below 1. */
export function walkMinutes(meters: number): number {
  if (!Number.isFinite(meters) || meters <= 0) return 1;
  return Math.max(1, Math.ceil(meters / METERS_PER_MINUTE));
}

// Past half an hour on foot the minute count stops being useful advice and
// starts being noise — show the distance instead and let the rider decide.
const WALK_LIMIT_MINUTES = 30;

/** "4 min walk" for anything within a half-hour stroll, else a plain "2.5 km". */
export function formatWalk(meters: number): string {
  const mins = walkMinutes(meters);
  if (mins > WALK_LIMIT_MINUTES) {
    const km = meters / 1000;
    return `${km >= 10 ? Math.round(km) : km.toFixed(1)} km`;
  }
  return `${mins} min walk`;
}
