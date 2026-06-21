import { getStopBoard } from "@/app/lib/oba";

// Realtime — never cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request, { params }: { params: Promise<{ stopId: string }> }) {
  const { stopId } = await params;
  // A deduped station passes its child platform ids (?ids=a,b) to aggregate.
  const idsParam = new URL(req.url).searchParams.get("ids");
  const memberIds = idsParam ? idsParam.split(",").filter(Boolean) : undefined;
  try {
    return Response.json(await getStopBoard(decodeURIComponent(stopId), memberIds));
  } catch (err) {
    console.error("stop board failed", err);
    return Response.json({ error: "stop unavailable" }, { status: 502 });
  }
}
