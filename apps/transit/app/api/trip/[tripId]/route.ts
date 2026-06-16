import { getTripDetail } from "@/app/lib/oba";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  try {
    return Response.json(await getTripDetail(decodeURIComponent(tripId)));
  } catch (err) {
    console.error("trip route failed", err);
    return Response.json({ error: "trip unavailable" }, { status: 502 });
  }
}
