import { getAreaBuses } from "@/app/lib/oba";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const num = (k: string) => Number(u.searchParams.get(k));
  const lat = num("lat");
  const lon = num("lon");
  const latSpan = num("latSpan");
  const lonSpan = num("lonSpan");
  if (![lat, lon, latSpan, lonSpan].every(Number.isFinite)) {
    return Response.json({ error: "lat, lon, latSpan, lonSpan required" }, { status: 400 });
  }
  // Cap span so a fully zoomed-out view can't ask for the whole region's buses.
  // The default city view (~0.65° wide) is comfortably under this.
  if (latSpan > 0.9 || lonSpan > 0.9) {
    return Response.json({ vehicles: [], at: Date.now(), tooWide: true });
  }
  try {
    return Response.json({
      vehicles: await getAreaBuses(lat, lon, latSpan, lonSpan),
      at: Date.now(),
    });
  } catch (err) {
    console.error("area route failed", err);
    return Response.json({ error: "area unavailable" }, { status: 502 });
  }
}
