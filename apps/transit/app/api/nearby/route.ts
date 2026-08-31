import { getNearbyStops } from "@/app/lib/oba";

export const dynamic = "force-dynamic";

// A walkable radius: below ~100 m nothing but the stop you're standing at comes
// back, above ~1.5 km it stops being "near you" and starts being the whole city.
const MIN_RADIUS = 100;
const MAX_RADIUS = 1500;
const DEFAULT_RADIUS = 800;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const lat = Number(u.searchParams.get("lat"));
  const lon = Number(u.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return Response.json({ error: "lat, lon required" }, { status: 400 });
  }
  const asked = Number(u.searchParams.get("radius"));
  const radius = Number.isFinite(asked)
    ? Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, asked))
    : DEFAULT_RADIUS;
  try {
    const { stops, routes } = await getNearbyStops(lat, lon, radius);
    return Response.json({ stops, routes, radius, at: Date.now() });
  } catch (err) {
    console.error("nearby route failed", err);
    return Response.json({ error: "nearby unavailable" }, { status: 502 });
  }
}
