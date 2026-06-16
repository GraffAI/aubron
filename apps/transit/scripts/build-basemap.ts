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
 *   - water     filled polygons: lakes (natural=water) + the marine fill of the
 *               Sound, recovered by polygonizing the coastline against a noded
 *               bbox frame and keeping cells that contain known open-water seeds.
 *   - coastline luminous strokes along the shoreline (incl. the Sound's edge).
 *   - roads     faint context lines (motorway / trunk), classed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  area,
  bboxClip,
  booleanPointInPolygon,
  featureCollection,
  lineString,
  point,
  polygonize,
  simplify,
} from "@turf/turf";
import type {
  Feature,
  FeatureCollection,
  LineString,
  MultiLineString,
  MultiPolygon,
  Polygon,
  Position,
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

// Points known to sit on open marine water — used to pick out the Sound and its
// passages from the polygonized coastline. Curated for this fixed bbox; kept off
// the islands (Vashon, Bainbridge, Blake) so we don't fill land. [lon, lat].
const MARINE_SEEDS: Position[] = [
  [-122.36, 47.6], // Elliott Bay
  [-122.45, 47.62], // central Sound
  [-122.42, 47.74], // Possession Sound (north)
  [-122.45, 47.8], // Sound (far north)
  [-122.37, 47.44], // East Passage (east of Vashon)
  [-122.51, 47.44], // Colvos Passage (west of Vashon)
  [-122.48, 47.32], // Dalco Passage (south, toward Tacoma)
  [-122.54, 47.57], // Rich Passage / Port Orchard (west)
  [-122.52, 47.7], // Agate Passage (north of Bainbridge)
  [-122.4, 47.5], // Sound off West Seattle
];

// The mainland is always the single biggest cell; never treat a cell this large
// as water (guards against a stray seed landing in it).
const MAX_WATER_CELL_FRAC = 0.55;

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
  // Overpass frequently 504s under load — retry with backoff.
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(OVERPASS, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "aubron-transit/0.1 (basemap build; github.com/GraffAI/aubron)",
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: query }).toString(),
    });
    const text = await res.text();
    if (res.ok && text.trimStart().startsWith("{")) {
      return osmtogeojson(JSON.parse(text));
    }
    console.warn(`  Overpass attempt ${attempt} → ${res.status}; retrying…`);
    await new Promise((r) => setTimeout(r, 4000 * attempt));
  }
  throw new Error("Overpass unavailable after retries");
}

const isPolygon = (f: Feature): f is Feature<Polygon | MultiPolygon> =>
  f.geometry?.type === "Polygon" || f.geometry?.type === "MultiPolygon";
const isLine = (f: Feature): f is Feature<LineString | MultiLineString> =>
  f.geometry?.type === "LineString" || f.geometry?.type === "MultiLineString";

function simplifyAll<T extends Feature>(features: T[], tolerance: number): T[] {
  return features.map((f) => simplify(f, { tolerance, highQuality: false, mutate: false }) as T);
}

/**
 * Recover marine water (the Sound + western inlets) as filled polygons. OSM only
 * gives the coastline as open lines, so: clip each line to the bbox, build a
 * frame around the bbox that is *split* (noded) at every point where a coastline
 * meets it, polygonize the lot into cells, and keep the cells that contain a
 * known open-water seed. (Naive polygonize without the noded frame can't close
 * the cells that touch the bbox edge, which is most of the Sound.)
 */
function marineWater(coastline: Feature<LineString | MultiLineString>[]): Feature<Polygon>[] {
  const [s, w, n, e] = BBOX;
  const eps = 1e-6;
  const onBoundary = (p: Position): boolean =>
    Math.abs(p[1]! - s) < eps ||
    Math.abs(p[1]! - n) < eps ||
    Math.abs(p[0]! - w) < eps ||
    Math.abs(p[0]! - e) < eps;

  const segments: Feature<LineString>[] = [];
  const boundaryPts: Position[] = [];
  for (const f of coastline) {
    let clipped;
    try {
      clipped = bboxClip(f, [w, s, e, n]);
    } catch {
      continue;
    }
    const g = clipped.geometry;
    if (!g) continue;
    const parts = g.type === "MultiLineString" ? g.coordinates : [g.coordinates as Position[]];
    for (const c of parts) {
      if (c.length < 2) continue;
      segments.push(lineString(c));
      for (const end of [c[0]!, c[c.length - 1]!]) if (onBoundary(end)) boundaryPts.push(end);
    }
  }

  // Position along the bbox perimeter (clockwise from the SW corner), used to
  // order the frame's split points.
  const width = e - w;
  const height = n - s;
  const perim = (p: Position): number => {
    if (Math.abs(p[1]! - s) < 1e-4) return p[0]! - w;
    if (Math.abs(p[0]! - e) < 1e-4) return width + (p[1]! - s);
    if (Math.abs(p[1]! - n) < 1e-4) return width + height + (e - p[0]!);
    return 2 * width + height + (n - p[1]!);
  };
  const corners: Position[] = [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
  ];
  const ordered = [...corners, ...boundaryPts]
    .map((p) => ({ p, t: perim(p) }))
    .sort((a, b) => a.t - b.t);
  const uniq: Position[] = [];
  for (const { p } of ordered) {
    const last = uniq[uniq.length - 1];
    if (!last || Math.hypot(p[0]! - last[0]!, p[1]! - last[1]!) > 1e-7) uniq.push(p);
  }
  for (let i = 0; i < uniq.length; i++) {
    segments.push(lineString([uniq[i]!, uniq[(i + 1) % uniq.length]!]));
  }

  let cells;
  try {
    cells = polygonize(featureCollection(segments));
  } catch (err) {
    console.warn(`⚠ marine polygonize failed (${String(err)}); shipping coastline strokes only`);
    return [];
  }
  const frameArea = area({
    type: "Polygon",
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  });
  return cells.features.filter(
    (cell) =>
      area(cell) < MAX_WATER_CELL_FRAC * frameArea &&
      MARINE_SEEDS.some((seed) => {
        try {
          return booleanPointInPolygon(point(seed), cell);
        } catch {
          return false;
        }
      }),
  );
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

  // Marine fill for the Sound, gated: only keep it if it covers a believable
  // share of the frame (guards against a bad polygonize flooding land or nothing).
  const [s, w, n, e] = BBOX;
  const frameArea = area({
    type: "Polygon",
    coordinates: [
      [
        [w, s],
        [e, s],
        [e, n],
        [w, n],
        [w, s],
      ],
    ],
  });
  const marine = marineWater(coastline);
  const marineFrac = marine.reduce((sum, f) => sum + area(f), 0) / frameArea;
  const keepMarine = marine.length > 0 && marineFrac > 0.15 && marineFrac < 0.9;
  console.log(
    `  lakes=${lakes.length} coastline=${coastline.length} roads=${roads.length} | marine cells=${marine.length} fill=${(marineFrac * 100).toFixed(0)}% → ${keepMarine ? "kept" : "dropped"}`,
  );

  const waterFeatures = [...(keepMarine ? marine : []), ...lakes];

  const out = {
    bbox: BBOX,
    water: featureCollection(simplifyAll(waterFeatures, 0.0001)),
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
