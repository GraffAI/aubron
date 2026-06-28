/**
 * Flag specs keyed by FIFA three-letter code. Designs are deliberately
 * simplified to read at ~14x10px: emblems become a disc or a star, complex
 * cantons become a couple of dots. Add a nation by adding one entry here and a
 * matching team in `teams.ts`. Unknown codes fall back to `FALLBACK`.
 */
import type { FlagSpec } from "./draw.js";

// Reusable palette.
const W = "#FFFFFF";
// "Black" is lifted to a visible near-black so black flag bands (Germany,
// Belgium) don't vanish into the unlit background on a real matrix.
const K = "#2C2C2C";

export const FLAGS: Record<string, FlagSpec> = {
  // ---- vertical tricolours -------------------------------------------------
  FRA: { layers: [{ kind: "bands", dir: "v", colors: ["#0055A4", W, "#EF4135"] }] },
  ITA: { layers: [{ kind: "bands", dir: "v", colors: ["#009246", W, "#CE2B37"] }] },
  BEL: { layers: [{ kind: "bands", dir: "v", colors: [K, "#FAE042", "#ED2939"] }] },
  IRL: { layers: [{ kind: "bands", dir: "v", colors: ["#169B62", W, "#FF883E"] }] },
  ROU: { layers: [{ kind: "bands", dir: "v", colors: ["#002B7F", "#FCD116", "#CE1126"] }] },
  NGA: { layers: [{ kind: "bands", dir: "v", colors: ["#008751", W, "#008751"] }] },
  CIV: { layers: [{ kind: "bands", dir: "v", colors: ["#F77F00", W, "#009E60"] }] },
  PER: { layers: [{ kind: "bands", dir: "v", colors: ["#D91023", W, "#D91023"] }] },
  GUI: { layers: [{ kind: "bands", dir: "v", colors: ["#CE1126", "#FCD116", "#009460"] }] },
  SEN: {
    layers: [
      { kind: "bands", dir: "v", colors: ["#00853F", "#FDEF42", "#E31B23"] },
      { kind: "star", cx: 0.5, cy: 0.5, r: 0.22, color: "#00853F" },
    ],
  },
  CMR: {
    layers: [
      { kind: "bands", dir: "v", colors: ["#007A5E", "#CE1126", "#FCD116"] },
      { kind: "star", cx: 0.5, cy: 0.5, r: 0.16, color: "#FCD116" },
    ],
  },
  MEX: {
    layers: [
      { kind: "bands", dir: "v", colors: ["#006847", W, "#CE1126"] },
      { kind: "disc", cx: 0.5, cy: 0.5, r: 0.12, color: "#6B4423" },
    ],
  },

  // ---- horizontal tricolours ----------------------------------------------
  DEU: { layers: [{ kind: "bands", dir: "h", colors: [K, "#DD0000", "#FFCE00"] }] },
  NLD: { layers: [{ kind: "bands", dir: "h", colors: ["#AE1C28", W, "#21468B"] }] },
  RUS: { layers: [{ kind: "bands", dir: "h", colors: [W, "#0039A6", "#D52B1E"] }] },
  AUT: { layers: [{ kind: "bands", dir: "h", colors: ["#ED2939", W, "#ED2939"] }] },
  HUN: { layers: [{ kind: "bands", dir: "h", colors: ["#CE2939", W, "#477050"] }] },
  COL: {
    layers: [
      { kind: "bands", dir: "h", colors: ["#FCD116", "#003893", "#CE1126"], weights: [2, 1, 1] },
    ],
  },
  ECU: {
    layers: [
      { kind: "bands", dir: "h", colors: ["#FFDD00", "#034EA2", "#ED1C24"], weights: [2, 1, 1] },
      { kind: "disc", cx: 0.5, cy: 0.5, r: 0.1, color: "#6B4423" },
    ],
  },
  ARG: {
    layers: [
      { kind: "bands", dir: "h", colors: ["#75AADB", W, "#75AADB"] },
      { kind: "disc", cx: 0.5, cy: 0.5, r: 0.12, color: "#F6B40E" },
    ],
  },
  SRB: { layers: [{ kind: "bands", dir: "h", colors: ["#C6363C", "#0C4076", W] }] },
  CRO: {
    layers: [
      { kind: "bands", dir: "h", colors: ["#FF0000", W, "#171796"] },
      { kind: "checker", x: 0.4, y: 0.28, w: 0.2, h: 0.44, cols: 3, rows: 3, a: "#FF0000", b: W },
    ],
  },

  // ---- spain / iberia ------------------------------------------------------
  ESP: {
    layers: [
      { kind: "bands", dir: "h", colors: ["#AA151B", "#F1BF00", "#AA151B"], weights: [1, 2, 1] },
      { kind: "rect", x: 0.24, y: 0.42, w: 0.12, h: 0.16, color: "#AD1519" },
    ],
  },
  POR: {
    layers: [
      { kind: "bands", dir: "v", colors: ["#006600", "#FF0000"], weights: [2, 3] },
      { kind: "disc", cx: 0.4, cy: 0.5, r: 0.16, color: "#FFCC00" },
      { kind: "disc", cx: 0.4, cy: 0.5, r: 0.08, color: "#003399" },
    ],
  },

  // ---- crosses -------------------------------------------------------------
  ENG: {
    layers: [
      { kind: "fill", color: W },
      { kind: "cross", color: "#CF142B", t: 0.18 },
    ],
  },
  CHE: {
    layers: [
      { kind: "fill", color: "#DA291C" },
      { kind: "rect", x: 0.42, y: 0.2, w: 0.16, h: 0.6, color: W },
      { kind: "rect", x: 0.25, y: 0.42, w: 0.5, h: 0.16, color: W },
    ],
  },
  DNK: {
    layers: [
      { kind: "fill", color: "#C8102E" },
      { kind: "cross", color: W, t: 0.16, ox: 0.36 },
    ],
  },
  SWE: {
    layers: [
      { kind: "fill", color: "#006AA7" },
      { kind: "cross", color: "#FECC00", t: 0.16, ox: 0.36 },
    ],
  },
  NOR: {
    layers: [
      { kind: "fill", color: "#BA0C2F" },
      { kind: "cross", color: W, t: 0.24, ox: 0.36 },
      { kind: "cross", color: "#00205B", t: 0.1, ox: 0.36 },
    ],
  },

  // ---- discs / stars -------------------------------------------------------
  JPN: {
    layers: [
      { kind: "fill", color: W },
      { kind: "disc", cx: 0.5, cy: 0.5, r: 0.3, color: "#BC002D" },
    ],
  },
  KOR: {
    layers: [
      { kind: "fill", color: W },
      { kind: "halfDisc", cx: 0.5, cy: 0.5, r: 0.28, color: "#CD2E3A", half: "top" },
      { kind: "halfDisc", cx: 0.5, cy: 0.5, r: 0.28, color: "#0047A0", half: "bottom" },
    ],
  },
  MAR: {
    layers: [
      { kind: "fill", color: "#C1272D" },
      { kind: "star", cx: 0.5, cy: 0.5, r: 0.26, color: "#006233" },
    ],
  },
  GHA: {
    layers: [
      { kind: "bands", dir: "h", colors: ["#CE1126", "#FCD116", "#006B3F"] },
      { kind: "star", cx: 0.5, cy: 0.5, r: 0.16, color: K },
    ],
  },
  TUR: {
    layers: [
      { kind: "fill", color: "#E30A17" },
      { kind: "ring", cx: 0.42, cy: 0.5, r: 0.22, t: 0.07, color: W },
      { kind: "star", cx: 0.56, cy: 0.5, r: 0.12, color: W },
    ],
  },

  // ---- brazil --------------------------------------------------------------
  BRA: {
    layers: [
      { kind: "fill", color: "#009C3B" },
      { kind: "diamond", color: "#FFDF00", s: 0.86 },
      { kind: "disc", cx: 0.5, cy: 0.5, r: 0.22, color: "#002776" },
      { kind: "rect", x: 0.28, y: 0.46, w: 0.44, h: 0.06, color: W },
    ],
  },

  // ---- usa / americas ------------------------------------------------------
  USA: {
    layers: [
      { kind: "bands", dir: "h", colors: ["#B22234", W, "#B22234", W, "#B22234", W, "#B22234"] },
      { kind: "rect", x: 0, y: 0, w: 0.42, h: 0.54, color: "#3C3B6E" },
      { kind: "star", cx: 0.13, cy: 0.18, r: 0.07, color: W },
      { kind: "star", cx: 0.3, cy: 0.18, r: 0.07, color: W },
      { kind: "star", cx: 0.21, cy: 0.36, r: 0.07, color: W },
      { kind: "star", cx: 0.13, cy: 0.42, r: 0.05, color: W },
      { kind: "star", cx: 0.3, cy: 0.42, r: 0.05, color: W },
    ],
  },
  CAN: {
    layers: [
      { kind: "bands", dir: "v", colors: ["#FF0000", W, "#FF0000"], weights: [1, 2, 1] },
      { kind: "star", cx: 0.5, cy: 0.5, r: 0.24, color: "#FF0000", points: 6, rot: 0.5 },
      { kind: "rect", x: 0.47, y: 0.5, w: 0.06, h: 0.22, color: "#FF0000" },
    ],
  },
  URY: {
    layers: [
      { kind: "fill", color: W },
      {
        kind: "bands",
        dir: "h",
        colors: ["#0038A8", W, "#0038A8", W, "#0038A8", W, "#0038A8", W, "#0038A8"],
      },
      { kind: "rect", x: 0, y: 0, w: 0.4, h: 0.44, color: W },
      { kind: "star", cx: 0.2, cy: 0.22, r: 0.16, color: "#FCD116" },
    ],
  },

  // ---- two-band ------------------------------------------------------------
  POL: { layers: [{ kind: "bands", dir: "h", colors: [W, "#DC143C"] }] },
  IDN: { layers: [{ kind: "bands", dir: "h", colors: ["#FF0000", W] }] },
  UKR: { layers: [{ kind: "bands", dir: "h", colors: ["#0057B7", "#FFD700"] }] },

  // ---- green field ---------------------------------------------------------
  SAU: {
    layers: [
      { kind: "fill", color: "#006C35" },
      { kind: "rect", x: 0.2, y: 0.6, w: 0.6, h: 0.07, color: W },
      { kind: "rect", x: 0.2, y: 0.42, w: 0.45, h: 0.1, color: W },
    ],
  },
  NZL: {
    layers: [
      { kind: "fill", color: "#00247D" },
      { kind: "rect", x: 0, y: 0, w: 0.4, h: 0.5, color: "#00247D" },
      { kind: "cross", color: "#CC142B", t: 0.06, ox: 0.2, oy: 0.25 },
      { kind: "star", cx: 0.72, cy: 0.5, r: 0.08, color: "#CC142B" },
      { kind: "star", cx: 0.85, cy: 0.3, r: 0.06, color: "#CC142B" },
    ],
  },
  AUS: {
    layers: [
      { kind: "fill", color: "#00247D" },
      { kind: "saltire", color: W, t: 0.05 },
      { kind: "cross", color: "#CF142B", t: 0.06, ox: 0.2, oy: 0.25 },
      { kind: "star", cx: 0.2, cy: 0.78, r: 0.1, color: W, points: 7 },
      { kind: "star", cx: 0.7, cy: 0.5, r: 0.07, color: W, points: 7 },
    ],
  },

  // ---- the rest of the 2026 field ------------------------------------------
  ALG: {
    layers: [
      { kind: "bands", dir: "v", colors: ["#006233", W] },
      { kind: "ring", cx: 0.5, cy: 0.5, r: 0.2, t: 0.09, color: "#D21034" },
      { kind: "star", cx: 0.57, cy: 0.5, r: 0.12, color: "#D21034" },
    ],
  },
  BIH: {
    layers: [
      { kind: "fill", color: "#002395" },
      { kind: "rect", x: 0.42, y: 0, w: 0.3, h: 1, color: "#FECB00" },
      { kind: "star", cx: 0.5, cy: 0.26, r: 0.1, color: W },
      { kind: "star", cx: 0.62, cy: 0.62, r: 0.1, color: W },
    ],
  },
  CPV: {
    layers: [
      {
        kind: "bands",
        dir: "h",
        colors: ["#003893", W, "#CF2027", W, "#003893"],
        weights: [6, 1, 1, 1, 3],
      },
      { kind: "star", cx: 0.32, cy: 0.55, r: 0.09, color: "#F7D116" },
    ],
  },
  COD: {
    layers: [
      { kind: "fill", color: "#007FFF" },
      { kind: "stripe", color: "#F7D618", t: 0.42, dir: "up" },
      { kind: "stripe", color: "#CE1021", t: 0.24, dir: "up" },
      { kind: "star", cx: 0.21, cy: 0.26, r: 0.14, color: "#F7D618" },
    ],
  },
  CUW: {
    layers: [
      { kind: "fill", color: "#002B7F" },
      { kind: "rect", x: 0, y: 0.6, w: 1, h: 0.16, color: "#F9D90F" },
      { kind: "star", cx: 0.22, cy: 0.28, r: 0.1, color: W },
      { kind: "star", cx: 0.36, cy: 0.5, r: 0.07, color: W },
    ],
  },
  CZE: {
    layers: [
      { kind: "bands", dir: "h", colors: [W, "#D7141A"] },
      { kind: "rect", x: 0, y: 0, w: 0.4, h: 1, color: "#11457E" },
    ],
  },
  EGY: {
    layers: [
      { kind: "bands", dir: "h", colors: ["#CE1126", W, K] },
      { kind: "star", cx: 0.5, cy: 0.5, r: 0.12, color: "#C8A04F" },
    ],
  },
  HAI: {
    layers: [
      { kind: "bands", dir: "h", colors: ["#00209F", "#D21034"] },
      { kind: "rect", x: 0.34, y: 0.34, w: 0.32, h: 0.32, color: W },
    ],
  },
  IRN: {
    layers: [
      { kind: "bands", dir: "h", colors: ["#239F40", W, "#DA0000"] },
      { kind: "star", cx: 0.5, cy: 0.5, r: 0.08, color: "#DA0000" },
    ],
  },
  IRQ: {
    layers: [
      { kind: "bands", dir: "h", colors: ["#CE1126", W, K] },
      { kind: "star", cx: 0.5, cy: 0.5, r: 0.1, color: "#007A3D" },
    ],
  },
  JOR: {
    layers: [
      { kind: "bands", dir: "h", colors: [K, W, "#007A3B"] },
      { kind: "rect", x: 0, y: 0, w: 0.36, h: 1, color: "#CE1126" },
      { kind: "star", cx: 0.17, cy: 0.5, r: 0.12, color: W, points: 7 },
    ],
  },
  PAN: {
    layers: [
      { kind: "fill", color: W },
      { kind: "rect", x: 0.5, y: 0, w: 0.5, h: 0.5, color: "#D21034" },
      { kind: "rect", x: 0, y: 0.5, w: 0.5, h: 0.5, color: "#072357" },
      { kind: "star", cx: 0.25, cy: 0.25, r: 0.12, color: "#072357" },
      { kind: "star", cx: 0.75, cy: 0.75, r: 0.12, color: "#D21034" },
    ],
  },
  PAR: {
    layers: [
      { kind: "bands", dir: "h", colors: ["#D52B1E", W, "#0038A8"] },
      { kind: "star", cx: 0.5, cy: 0.5, r: 0.09, color: "#2E7D32" },
    ],
  },
  QAT: {
    layers: [
      { kind: "fill", color: "#8A1538" },
      { kind: "rect", x: 0, y: 0, w: 0.3, h: 1, color: W },
    ],
  },
  SCO: {
    layers: [
      { kind: "fill", color: "#0065BF" },
      { kind: "saltire", color: W, t: 0.22 },
    ],
  },
  RSA: {
    layers: [
      {
        kind: "bands",
        dir: "h",
        colors: ["#E03C31", W, "#007A4D", W, "#001489"],
        weights: [3, 1, 2, 1, 3],
      },
      { kind: "rect", x: 0, y: 0, w: 0.32, h: 1, color: K },
    ],
  },
  TUN: {
    layers: [
      { kind: "fill", color: "#E70013" },
      { kind: "disc", cx: 0.5, cy: 0.5, r: 0.24, color: W },
      { kind: "ring", cx: 0.52, cy: 0.5, r: 0.14, t: 0.06, color: "#E70013" },
      { kind: "star", cx: 0.57, cy: 0.5, r: 0.09, color: "#E70013" },
    ],
  },
  UZB: {
    layers: [
      { kind: "bands", dir: "h", colors: ["#0099B5", W, "#1EB53A"] },
      { kind: "ring", cx: 0.2, cy: 0.2, r: 0.1, t: 0.045, color: W },
      { kind: "star", cx: 0.36, cy: 0.2, r: 0.05, color: W },
    ],
  },
};

/** Neutral fallback for nations without a dedicated spec — a clean field the
 * 3-letter code is drawn over by the scoreboard. */
export const FALLBACK: FlagSpec = {
  layers: [
    { kind: "bands", dir: "h", colors: ["#2B3A55", "#1C2638"] },
    { kind: "rect", x: 0.04, y: 0.08, w: 0.92, h: 0.84, color: "#33415C" },
  ],
};

export function flagFor(code: string): FlagSpec {
  return FLAGS[code.toUpperCase()] ?? FALLBACK;
}

export function hasFlag(code: string): boolean {
  return code.toUpperCase() in FLAGS;
}
