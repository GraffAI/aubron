import { getNetwork } from "@/app/lib/oba";

// Run at request time (never prerendered at build, so the build doesn't depend
// on OBA). The underlying OBA calls are cached for a day at the fetch layer, so
// this stays cheap.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getNetwork());
  } catch (err) {
    console.error("network route failed", err);
    return Response.json({ error: "network unavailable" }, { status: 502 });
  }
}
