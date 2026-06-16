import { getVehicles } from "@/app/lib/oba";

// Realtime — never cache.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    return Response.json({ vehicles: await getVehicles(), at: Date.now() });
  } catch (err) {
    console.error("vehicles route failed", err);
    return Response.json({ error: "vehicles unavailable" }, { status: 502 });
  }
}
