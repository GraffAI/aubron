import { getStopBoard } from "@/app/lib/oba";

// Realtime — never cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(_req: Request, { params }: { params: Promise<{ stopId: string }> }) {
  const { stopId } = await params;
  try {
    return Response.json(await getStopBoard(decodeURIComponent(stopId)));
  } catch (err) {
    console.error("stop board failed", err);
    return Response.json({ error: "stop unavailable" }, { status: 502 });
  }
}
