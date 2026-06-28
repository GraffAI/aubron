/**
 * Real flag artwork from the ReffPixels pixel-art pack (CC-BY 4.0), loaded as
 * sprites at the two native sizes we draw: 12×8 (scoreboard / ticker) and 24×16
 * (goal hero). The PNGs live under `assets/flags/<size>/` and are NOT committed
 * (the licence forbids redistribution) — populate them with
 * `deploy/install-flags.sh`. When a file is absent (CI, a fresh clone, or an
 * unmapped nation) we fall back to the hand-coded DSL flag, so everything still
 * renders without the pack.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";

import type { Sprite } from "../canvas.js";
import { renderFlag } from "./draw.js";
import { flagFor } from "./registry.js";

/** FIFA three-letter code → ReffPixels filename (without extension). */
const FILE: Record<string, string> = {
  BRA: "Brazil",
  ARG: "Argentina",
  FRA: "France",
  ENG: "England",
  ESP: "Spain",
  DEU: "Germany",
  POR: "Portugal",
  NLD: "Netherlands",
  ITA: "Italy",
  BEL: "Belgium",
  CRO: "Croatia",
  USA: "UnitedStatesOfAmerica",
  MEX: "Mexico",
  CAN: "Canada",
  JPN: "Japan",
  KOR: "RepublicOfKorea",
  MAR: "Morocco",
  SEN: "Senegal",
  URY: "Uruguay",
  COL: "Colombia",
  ECU: "Ecuador",
  PER: "Peru",
  CHE: "Switzerland",
  DNK: "Denmark",
  SWE: "Sweden",
  NOR: "Norway",
  POL: "Poland",
  AUT: "Austria",
  SRB: "Serbia",
  GHA: "Ghana",
  CMR: "Cameroon",
  CIV: "CoteDlvoire",
  NGA: "Nigeria",
  AUS: "Australia",
  SAU: "SaudiArabia",
  TUR: "Turkey",
  NZL: "NewZealand",
  RUS: "RussianFederation",
  UKR: "Ukraine",
  IRL: "Ireland",
  ROU: "Romania",
  HUN: "Hungary",
  IDN: "Indonesia",
  ALG: "Algeria",
  BIH: "BosniaAndHerzegovina",
  CPV: "CaboVerde",
  COD: "DemocraticRepublicOfTheCongo",
  CZE: "CzechRepublic",
  EGY: "Egypt",
  HAI: "Haiti",
  IRN: "Iran",
  IRQ: "Iraq",
  JOR: "Jordan",
  PAN: "Panama",
  PAR: "Paraguay",
  QAT: "Qatar",
  SCO: "Scotland",
  RSA: "SouthAfrica",
  TUN: "Tunisia",
  UZB: "Uzbekistan",
};

/** FIFA codes that have a mapped sprite file (for contact-sheet previews). */
export const SPRITE_CODES: string[] = Object.keys(FILE);

function assetDir(): string {
  if (process.env.WC_FLAG_DIR) return process.env.WC_FLAG_DIR;
  return fileURLToPath(new URL("../assets/flags/", import.meta.url));
}

/** Map a requested pixel size to the pack's native folder, or null if none. */
function sizeFolder(w: number, h: number): string | null {
  if (w === 12 && h === 8) return "12x8";
  if (w === 24 && h === 16) return "24x16";
  if (w === 48 && h === 32) return "48x32";
  return null;
}

/**
 * Replace the pack's 1px dark outline (and the darker diagonal pixel just inside
 * each corner) by bleeding the adjacent flag colour outward. The result is a
 * solid, full-bleed flag: no muddy border, and — crucially — no transparent/off
 * pixels that would read as black corners, especially once scaled to 18×12.
 */
function fillBorder(s: Sprite): void {
  const { width: w, height: h, data } = s;
  const get = (x: number, y: number): [number, number, number] => {
    const i = (y * w + x) * 4;
    return [data[i]!, data[i + 1]!, data[i + 2]!];
  };
  const set = (x: number, y: number, c: [number, number, number]): void => {
    const i = (y * w + x) * 4;
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
    data[i + 3] = 255;
  };
  // The corner rounding pixel is a darkened shade — swap it for the field colour.
  set(1, 1, get(2, 2));
  set(w - 2, 1, get(w - 3, 2));
  set(1, h - 2, get(2, h - 3));
  set(w - 2, h - 2, get(w - 3, h - 3));
  // Bleed the second ring out over the outline ring (and the transparent corners).
  for (let x = 1; x < w - 1; x++) {
    set(x, 0, get(x, 1));
    set(x, h - 1, get(x, h - 2));
  }
  for (let y = 0; y < h; y++) {
    set(0, y, get(1, y));
    set(w - 1, y, get(w - 2, y));
  }
}

const cache = new Map<string, Sprite | null>();

function load(folder: string, file: string): Sprite | null {
  const key = `${folder}/${file}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let sprite: Sprite | null = null;
  try {
    const png = PNG.sync.read(readFileSync(join(assetDir(), folder, `${file}.png`)));
    sprite = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
    fillBorder(sprite);
  } catch {
    // missing file → leave null and fall back to the DSL flag
  }
  cache.set(key, sprite);
  return sprite;
}

/** Nearest-neighbour resize of an RGBA sprite (for non-native sizes like 18×12). */
function scaleSprite(src: Sprite, w: number, h: number): Sprite {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / w));
      const di = (y * w + x) * 4;
      const si = (sy * src.width + sx) * 4;
      data[di] = src.data[si]!;
      data[di + 1] = src.data[si + 1]!;
      data[di + 2] = src.data[si + 2]!;
      data[di + 3] = src.data[si + 3]!;
    }
  }
  return { width: w, height: h, data };
}

const scaledCache = new Map<string, Sprite | null>();

/**
 * A flag sprite at the requested size: the real pixel-art PNG at a native size,
 * a once-scaled copy of the nearest native size for in-between sizes (e.g. the
 * 18×12 scoreboard flag), or the hand-coded DSL flag when the pack is absent.
 */
export function flagSprite(code: string, w: number, h: number): Sprite {
  const file = FILE[code.toUpperCase()];
  if (!file) return renderFlag(flagFor(code), w, h);

  const folder = sizeFolder(w, h);
  if (folder) return load(folder, file) ?? renderFlag(flagFor(code), w, h);

  const key = `${file}@${w}x${h}`;
  const hit = scaledCache.get(key);
  if (hit !== undefined) return hit ?? renderFlag(flagFor(code), w, h);
  const base = load("24x16", file) ?? load("12x8", file);
  const scaled = base ? scaleSprite(base, w, h) : null;
  scaledCache.set(key, scaled);
  return scaled ?? renderFlag(flagFor(code), w, h);
}
