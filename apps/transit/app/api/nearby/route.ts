import { getNearbyStops } from "@/app/lib/oba";

export const dynamic = "force-dynamic";

// A walkable radius: below ~100 m nothing but the stop you're standing at comes
// back, above ~1.5 km it stops being "near you" and starts being the whole city.
const MIN_RADIUS = 100;
const MAX_RADIUS = 1500;
const DEFAULT_RADIUS = 800;

// A missing param must read as ABSENT, not as zero: Number(null) is 0, which is
// finite — so a plain Number() would accept a lat-less request as (0, 0) and
// silently clamp a radius-less one to the minimum instead of the default.
function num(u: URL, k: string): number | null {
  const raw = u.searchParams.get(k);
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const lat = num(u, "lat");
  const lon = num(u, "lon");
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return Response.json({ error: "lat, lon required" }, { status: 400 });
  }
  const asked = num(u, "radius");
  const radius = asked == null ? DEFAULT_RADIUS : Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, asked));
  try {
    const { stops, routes } = await getNearbyStops(lat, lon, radius);
    return Response.json({ stops, routes, radius, at: Date.now() });
  } catch (err) {
    console.error("nearby route failed", err);
    return Response.json({ error: "nearby unavailable" }, { status: 502 });
  }
}
