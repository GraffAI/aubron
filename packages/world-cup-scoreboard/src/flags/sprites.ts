/**
 * Real flag artwork generated from the official Wikimedia Commons SVGs by
 * `scripts/genflags.ts` (palette-snapped + salience-weighted downscale — see
 * that file for the method). The PNGs are committed under
 * `assets/flags/<size>/<FIFA>.png` at the four native sizes the scenes draw:
 * 12×8 (kickoff/shootout), 18×12 (scoreboard), 24×16 (goal hero / schedule)
 * and 48×32 (headroom for bigger panels). When a file is absent (an unmapped
 * nation, or an odd requested size) we fall back to nearest-neighbour scaling
 * and ultimately to the hand-coded DSL flag, so everything still renders.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PNG } from "pngjs";

import type { Sprite } from "../canvas.js";
import { renderFlag } from "./draw.js";
import { FLAGS, flagFor } from "./registry.js";

/** FIFA codes with a dedicated flag design (for contact-sheet previews). */
export const SPRITE_CODES: string[] = Object.keys(FLAGS);

let resolvedAssetDir: string | undefined;

function assetDir(): string {
  if (process.env.WC_FLAG_DIR) return process.env.WC_FLAG_DIR;
  if (resolvedAssetDir === undefined) {
    // One level up from the bundled dist/index.js, two up from src/flags/ when
    // running unbundled (tsx, vitest) — probe both so dev sees the real art.
    const candidates = ["../assets/flags/", "../../assets/flags/"];
    resolvedAssetDir =
      candidates.map((c) => fileURLToPath(new URL(c, import.meta.url))).find(existsSync) ??
      fileURLToPath(new URL(candidates[0]!, import.meta.url));
  }
  return resolvedAssetDir;
}

/** The generated sprite sizes, largest first (keep in sync with genflags.ts). */
const NATIVE: Array<[number, number]> = [
  [48, 32],
  [24, 16],
  [18, 12],
  [12, 8],
];

function sizeFolder(w: number, h: number): string | null {
  return NATIVE.some(([nw, nh]) => nw === w && nh === h) ? `${w}x${h}` : null;
}

const cache = new Map<string, Sprite | null>();

function load(folder: string, code: string): Sprite | null {
  const key = `${folder}/${code}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let sprite: Sprite | null = null;
  try {
    const png = PNG.sync.read(readFileSync(join(assetDir(), folder, `${code}.png`)));
    sprite = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
  } catch {
    // missing file → leave null and fall back to the DSL flag
  }
  cache.set(key, sprite);
  return sprite;
}

/** Nearest-neighbour resize of an RGBA sprite (for non-native sizes). */
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
 * A flag sprite at the requested size: the generated PNG at a native size, a
 * once-scaled copy of the smallest native size that covers an in-between
 * request, or the hand-coded DSL flag when no PNG exists for the nation.
 */
export function flagSprite(code: string, w: number, h: number): Sprite {
  const upper = code.toUpperCase();

  const folder = sizeFolder(w, h);
  if (folder) return load(folder, upper) ?? renderFlag(flagFor(code), w, h);

  const key = `${upper}@${w}x${h}`;
  const hit = scaledCache.get(key);
  if (hit !== undefined) return hit ?? renderFlag(flagFor(code), w, h);
  // Prefer the smallest native sprite that still covers the request (its
  // pixels were voted for a size close to this one), falling back to largest.
  const covering = [...NATIVE].reverse().find(([nw, nh]) => nw >= w && nh >= h) ?? NATIVE[0]!;
  const base = load(`${covering[0]}x${covering[1]}`, upper);
  const scaled = base ? scaleSprite(base, w, h) : null;
  scaledCache.set(key, scaled);
  return scaled ?? renderFlag(flagFor(code), w, h);
}
