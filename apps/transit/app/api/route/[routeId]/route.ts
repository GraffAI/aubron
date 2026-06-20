import { getRouteGeometry } from "@/app/lib/oba";

// Geometry is cached a day at the OBA fetch layer, so this stays cheap.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ routeId: string }> }) {
  const { routeId } = await params;
  try {
    return Response.json(await getRouteGeometry(decodeURIComponent(routeId)));
  } catch (err) {
    console.error("route geometry failed", err);
    return Response.json({ error: "route unavailable" }, { status: 502 });
  }
}
