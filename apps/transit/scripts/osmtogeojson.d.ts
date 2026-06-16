declare module "osmtogeojson" {
  import type { FeatureCollection } from "geojson";

  /** Convert Overpass/OSM JSON (with `out body; >; out skel qt;`) to GeoJSON. */
  export default function osmtogeojson(
    data: unknown,
    options?: { flatProperties?: boolean },
  ): FeatureCollection;
}
