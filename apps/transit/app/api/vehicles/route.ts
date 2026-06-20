import { getVehicles } from "@/app/lib/oba";
import type { Vehicle } from "@/app/lib/transit";

// Realtime — never cache at the framework level.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// The upstream feed only refreshes in bursts every ~16s, so briefly memoize the
// assembled vehicle list: many viewers (and the ~8s client poll) then share one
// upstream fetch cadence instead of each fanning out to OBA. Caching the promise
// also coalesces concurrent requests. Short enough that positions stay live.
const TTL_MS = 5_000;
let cache: { at: number; data: Promise<Vehicle[]> } | null = null;

function vehicles(): Promise<Vehicle[]> {
  const now = Date.now();
  if (!cache || now - cache.at >= TTL_MS) {
    const data = getVehicles();
    cache = { at: now, data };
    // A failed fetch shouldn't be served for the whole TTL — drop it.
    data.catch(() => {
      if (cache?.data === data) cache = null;
    });
  }
  return cache.data;
}

export async function GET() {
  try {
    return Response.json({ vehicles: await vehicles(), at: Date.now() });
  } catch (err) {
    console.error("vehicles route failed", err);
    return Response.json({ error: "vehicles unavailable" }, { status: 502 });
  }
}
