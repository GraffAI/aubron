/**
 * The palette. Dark, cool, luminous — water and land share the near-black void;
 * every shoreline reads as the same soft, muted edge, transit lines as the
 * bright signal. Colors are RGBA tuples for deck.gl; matching CSS hex in globals.css.
 */
export type RGBA = [number, number, number, number];

export const COLORS = {
  void: [5, 7, 10, 255] as RGBA,
  waterFill: [12, 22, 34, 255] as RGBA,
  waterEdge: [40, 78, 96, 120] as RGBA,
  road: [120, 134, 158, 32] as RGBA,
  // Live vehicles ride lines drawn in their own color, so the marker can't *be*
  // that color or it vanishes into the route. A bright body lifts the train off
  // the line (it's the brightest mark on the map — the "signal"); a dark hairline
  // edge crisps it against the line so it reads at every zoom.
  markerCore: [237, 244, 252, 255] as RGBA,
  markerEdge: [4, 7, 11, 235] as RGBA,
} as const;

/** Official-ish Sound Transit line colors, brightened for the dark map. */
export const LINE_COLORS: Record<string, RGBA> = {
  "1 Line": [0, 169, 79, 255], // green
  "2 Line": [0, 122, 201, 255], // blue
  "T Line": [241, 110, 30, 255], // orange
  bus: [150, 160, 178, 220],
} as const;

export const RAIL_FALLBACK: RGBA = [150, 170, 190, 220];

/** Parse a GTFS route_color ("RRGGBB", optionally "#"-prefixed) to RGBA. */
export function parseGtfsColor(hex: string | undefined): RGBA | null {
  if (!hex) return null;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, 255];
}

/**
 * The color for a line: the hand-tuned palette first (brightened for the dark
 * map), then the agency's GTFS route_color (how Sounder's steel blue and Amtrak's
 * slate get in without hardcoding every route), then the neutral rail fallback.
 */
export function colorFor(shortName: string, gtfsColor?: string): RGBA {
  return LINE_COLORS[shortName] ?? parseGtfsColor(gtfsColor) ?? RAIL_FALLBACK;
}
