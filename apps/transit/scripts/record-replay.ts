// Record a slice of the live rail feed into a replay the map can play back
// (public/replay/<name>.json.gz — see app/lib/replay.ts for the player).
//
// Two modes:
//   pnpm --filter transit data:replay -- --minutes 30            # record live
//   pnpm --filter transit data:replay -- --from-capture f.jsonl  # convert an
//     audit capture (JSONL of {t, kind:"trips", data} lines) into a replay.
//
// Both run every sample through the SAME trips→Vehicle mapping the live /api
// routes use (vehiclesFromTrips), so playback is faithful to production.

import { gzipSync } from "node:zlib";
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import { getVehicles, vehiclesFromTrips, type TripsResponse } from "../app/lib/oba";
import { isRailType, type Vehicle } from "../app/lib/transit";

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const minutes = Number(opt("minutes") ?? 30);
const intervalSec = Number(opt("interval") ?? 10);
const name = opt("name") ?? "replay";
const fromCapture = opt("from-capture");

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "replay");
const outFile = join(outDir, `${name}.json.gz`);

interface Frame {
  t: number;
  vehicles: Vehicle[];
}

const round = (n: number): number => Math.round(n * 1e5) / 1e5;

/** Trim a vehicle for storage: rounded coords, no undefined keys (JSON drops them). */
function compact(v: Vehicle): Vehicle {
  return {
    ...v,
    lon: round(v.lon),
    lat: round(v.lat),
    heading: Math.round(v.heading),
    nextStopLon: v.nextStopLon != null ? round(v.nextStopLon) : undefined,
    nextStopLat: v.nextStopLat != null ? round(v.nextStopLat) : undefined,
  };
}

function label(start: number, end: number): string {
  const day = new Date(start).toLocaleDateString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const t = (ms: number) =>
    new Date(ms).toLocaleTimeString("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      minute: "2-digit",
    });
  return `${day} · ${t(start)}–${t(end)}`;
}

function write(frames: Frame[]): void {
  if (frames.length === 0) throw new Error("no frames recorded");
  const start = frames[0]!.t;
  const end = frames[frames.length - 1]!.t;
  const data = { label: label(start, end), start, end, frames };
  const raw = Buffer.from(JSON.stringify(data));
  const gz = gzipSync(raw, { level: 9 });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, gz);
  console.log(
    `${outFile}: ${frames.length} frames over ${Math.round((end - start) / 60000)}min, ` +
      `${(raw.length / 1e6).toFixed(1)}MB → ${(gz.length / 1e3).toFixed(0)}KB gzipped`,
  );
}

/** Convert an audit capture: bucket its trips-for-route responses into frames. */
async function convert(file: string): Promise<void> {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  const frames: Frame[] = [];
  let cur: { t: number; byTrip: Map<string, Vehicle> } | null = null;
  const flush = () => {
    if (!cur) return;
    frames.push({
      t: cur.t,
      vehicles: [...cur.byTrip.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map(compact),
    });
    cur = null;
  };
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec: { t: number; kind: string; data: TripsResponse };
    try {
      rec = JSON.parse(line) as typeof rec;
    } catch {
      continue; // torn tail line from a live capture
    }
    if (rec.kind !== "trips") continue;
    // One poll's route queries land within a couple seconds; a gap means a new frame.
    if (cur && rec.t - cur.t > 5000) flush();
    cur ??= { t: rec.t, byTrip: new Map() };
    for (const v of vehiclesFromTrips(rec.data, (r) => isRailType(r.type), rec.t)) {
      cur.byTrip.set(v.tripId, v);
    }
  }
  flush();
  write(frames);
}

/** Record the live feed for `minutes`, sampling every `intervalSec`. */
async function record(): Promise<void> {
  const endAt = Date.now() + minutes * 60_000;
  const frames: Frame[] = [];
  for (;;) {
    const t = Date.now();
    try {
      const vehicles = (await getVehicles()).sort((a, b) => (a.id < b.id ? -1 : 1)).map(compact);
      frames.push({ t, vehicles });
      console.log(`frame ${frames.length}: ${vehicles.length} vehicles`);
    } catch (err) {
      console.error("sample failed", err);
    }
    if (Date.now() + intervalSec * 1000 > endAt) break;
    await new Promise((r) => setTimeout(r, Math.max(0, intervalSec * 1000 - (Date.now() - t))));
  }
  write(frames);
}

if (fromCapture) await convert(fromCapture);
else await record();
