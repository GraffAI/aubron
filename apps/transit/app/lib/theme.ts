/**
 * The palette. Dark, cool, luminous — water and land share the near-black void;
 * the shoreline reads as a glowing edge, transit lines as the bright signal.
 * Colors are RGBA tuples for deck.gl; the matching CSS hex lives in globals.css.
 */
export type RGBA = [number, number, number, number];

export const COLORS = {
  void: [5, 7, 10, 255] as RGBA,
  waterFill: [12, 22, 34, 255] as RGBA,
  coastline: [88, 158, 190, 205] as RGBA,
  road: [120, 134, 158, 32] as RGBA,
} as const;

/** Official-ish Sound Transit line colors, used once vehicles land. */
export const LINE_COLORS: Record<string, RGBA> = {
  "1 Line": [0, 169, 79, 255], // green
  "2 Line": [0, 122, 201, 255], // blue
  "T Line": [241, 110, 30, 255], // orange
  "N Line": [124, 58, 173, 255], // Sounder purple-ish
  "S Line": [0, 150, 143, 255], // Sounder teal
  bus: [150, 160, 178, 220],
} as const;
