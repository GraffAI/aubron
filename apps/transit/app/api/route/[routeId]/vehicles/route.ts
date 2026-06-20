import { getRouteVehicles } from "@/app/lib/oba";

// Realtime — never cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_req: Request, { params }: { params: Promise<{ routeId: string }> }) {
  const { routeId } = await params;
  try {
    return Response.json({
      vehicles: await getRouteVehicles(decodeURIComponent(routeId)),
      at: Date.now(),
    });
  } catch (err) {
    console.error("route vehicles failed", err);
    return Response.json({ error: "route vehicles unavailable" }, { status: 502 });
  }
}
