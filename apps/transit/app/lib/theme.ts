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
} as const;

/** Official-ish Sound Transit line colors, used once vehicles land. */
export const LINE_COLORS: Record<string, RGBA> = {
  "1 Line": [0, 169, 79, 255], // green
  "2 Line": [0, 122, 201, 255], // blue
  "T Line": [241, 110, 30, 255], // orange
  bus: [150, 160, 178, 220],
} as const;
