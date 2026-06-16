/**
 * build-basemap.ts — generate the bespoke map's background geometry.
 *
 * We render Puget Sound ourselves (no tile provider), so this fetches the raw
 * vector geometry from OpenStreetMap (via Overpass), turns it into GeoJSON,
 * simplifies it, and writes a single compact `public/basemap.json` the client
 * draws with deck.gl. Run once and commit the output:
 *
 *   pnpm --filter transit data:basemap
 *
 * Layers produced:
 *   - water     filled lake polygons (natural=water), tiny ponds dropped.
 *   - coastline luminous strokes along the shoreline (incl. the Sound's edge).
 *   - roads     faint context lines (motorway / trunk), classed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { area, featureCollection, simplify } from "@turf/turf";
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
  MultiPolygon,
  Polygon,
} from "geojson";
import osmtogeojson from "osmtogeojson";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "public", "basemap.json");

// Puget Sound core: Everett-ish down past SeaTac, Sound to the Eastside lakes —
// covers the full Link/Sounder corridor. [south, west, north, east].
const BBOX: [number, number, number, number] = [47.2, -122.55, 47.9, -122.0];

// Keep only water bodies bigger than this (m²) — drops thousands of tiny ponds,
// keeps the lakes that orient you (Washington, Union, Green, Sammamish…).
const MIN_LAKE_AREA = 60_000;

const OVERPASS = "https://overpass-api.de/api/interpreter";

async function fetchOsm(): Promise<FeatureCollection> {
  const [s, w, n, e] = BBOX;
  const bbox = `${s},${w},${n},${e}`;
  const query = `[out:json][timeout:180];
(
  way["natural"="water"](${bbox});
  relation["natural"="water"](${bbox});
  way["natural"="coastline"](${bbox});
  way["highway"~"^(motorway|trunk)$"](${bbox});
);
out body;
>;
out skel qt;`;

  console.log("→ querying Overpass…");
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "aubron-transit/0.1 (basemap build; github.com/GraffAI/aubron)",
      Accept: "application/json",
    },
    body: new URLSearchParams({ data: query }).toString(),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${await res.text()}`);
  const osm: unknown = await res.json();
  return osmtogeojson(osm);
}

const isPolygon = (f: Feature): f is Feature<Polygon | MultiPolygon> =>
  f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon";
const isLine = (f: Feature): f is Feature<LineString | MultiLineString> =>
  f.geometry?.type === "LineString" || f.geometry?.type === "MultiLineString";

function simplifyAll<T extends Feature>(features: T[], tolerance: number): T[] {
  return features.map((f) => simplify(f, { tolerance, highQuality: false, mutate: false }) as T);
}

async function main(): Promise<void> {
  const geo = await fetchOsm();
  const feats = geo.features;

  const lakes = feats
    .filter(
      (f): f is Feature<Polygon | MultiPolygon> =>
        isPolygon(f) && f.properties?.natural === "water",
    )
    .filter((f) => area(f) >= MIN_LAKE_AREA);
  const coastline = feats.filter(
    (f): f is Feature<LineString | MultiLineString> =>
      isLine(f) && f.properties?.natural === "coastline",
  );
  const roads = feats
    .filter((f): f is Feature<LineString | MultiLineString> => isLine(f) && !!f.properties?.highway)
    .map((f) => ({
      ...f,
      properties: { class: String(f.properties?.highway ?? "road") },
    }));

  console.log(
    `  lakes=${lakes.length} (>= ${MIN_LAKE_AREA}m²) coastline=${coastline.length} roads=${roads.length}`,
  );

  const out = {
    bbox: BBOX,
    water: featureCollection(simplifyAll(lakes, 0.0001)),
    coastline: featureCollection(simplifyAll(coastline, 0.0001)),
    roads: featureCollection(simplifyAll(roads, 0.0002)),
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  const kb = (JSON.stringify(out).length / 1024).toFixed(0);
  console.log(`✔ wrote ${OUT} (${kb} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
