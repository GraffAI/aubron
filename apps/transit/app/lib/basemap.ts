import type { FeatureCollection } from "geojson";

/** Shape of public/basemap.json, produced by scripts/build-basemap.ts. */
export interface Basemap {
  /** [south, west, north, east] */
  bbox: [number, number, number, number];
  /** Marine water (the Sound + passages), drawn lit. */
  marine: FeatureCollection;
  /** Landmasses (mainland + islands), drawn over marine to mask any bleed. */
  land: FeatureCollection;
  /** Lakes, drawn lit over the land. */
  lakes: FeatureCollection;
  coastline: FeatureCollection;
  roads: FeatureCollection;
}

export async function loadBasemap(signal?: AbortSignal): Promise<Basemap> {
  const res = await fetch("/basemap.json", { signal });
  if (!res.ok) throw new Error(`basemap.json ${res.status}`);
  return (await res.json()) as Basemap;
}
