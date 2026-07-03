/**
 * Generate the committed LED flag sprites from authoritative Wikimedia Commons
 * SVGs — `pnpm gen:flags [CODES…]`.
 *
 * Naive downscaling (area-average or nearest-neighbour) is exactly what makes
 * flags unreadable on a sparse LED matrix: averaging melts a maple leaf into a
 * pink smear, nearest-neighbour turns it into noise, and any shaded source art
 * reads as random dim pixels. This pipeline is built so those failure modes
 * cannot happen:
 *
 *   1. Rasterise the official SVG large (480px wide) with resvg.
 *   2. Recover the flag's true *palette* — flags are flat-colour art, so a
 *      histogram of the raster (minus anti-aliasing noise) yields the handful
 *      of real colours. Every output pixel is snapped to this palette, so the
 *      sprite is flat by construction: no shading, no AA mush, full LED
 *      saturation.
 *   3. For each LED cell, vote among palette colours by *salience-weighted
 *      coverage*: a colour's share of the cell, boosted by how rare it is in
 *      the cell's neighbourhood. Canada's leaf red is common globally (the
 *      side bands) but rare inside the white pale — the boost is what lets
 *      the leaf win its cells instead of being averaged away, while plain
 *      band interiors are untouched (the dominant colour also wins the vote).
 *   4. Lift near-black to #2C2C2C (same as the DSL flags) so black bands stay
 *      visible against the unlit panel background.
 *
 * Output: assets/flags/{12x8,18x12,24x16,48x32}/<FIFA>.png (committed — the
 * source flags are public domain, unlike the icon pack this replaces).
 * Downloads are cached in assets/flags/.svg-cache/ (gitignored).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";
import { PNG } from "pngjs";

// ---------------------------------------------------------------------------
// Sources: FIFA code → Wikimedia Commons file title. All are public-domain
// national flags served via the stable Special:FilePath redirect.
// ---------------------------------------------------------------------------
const SOURCES: Record<string, string> = {
  ALG: "Flag of Algeria.svg",
  ARG: "Flag of Argentina.svg",
  AUS: "Flag of Australia (converted).svg",
  AUT: "Flag of Austria.svg",
  BEL: "Flag of Belgium (civil).svg",
  BIH: "Flag of Bosnia and Herzegovina.svg",
  BRA: "Flag of Brazil.svg",
  CAN: "Flag of Canada (Pantone).svg",
  CHE: "Flag of Switzerland.svg",
  CIV: "Flag of Côte d'Ivoire.svg",
  CMR: "Flag of Cameroon.svg",
  COD: "Flag of the Democratic Republic of the Congo.svg",
  COL: "Flag of Colombia.svg",
  CPV: "Flag of Cape Verde.svg",
  CRO: "Flag of Croatia.svg",
  CUW: "Flag of Curaçao.svg",
  CZE: "Flag of the Czech Republic.svg",
  DEU: "Flag of Germany.svg",
  DNK: "Flag of Denmark.svg",
  ECU: "Flag of Ecuador.svg",
  EGY: "Flag of Egypt.svg",
  ENG: "Flag of England.svg",
  ESP: "Flag of Spain.svg",
  FRA: "Flag of France.svg",
  GHA: "Flag of Ghana.svg",
  GUI: "Flag of Guinea.svg",
  HAI: "Flag of Haiti.svg",
  HUN: "Flag of Hungary.svg",
  IDN: "Flag of Indonesia.svg",
  IRL: "Flag of Ireland.svg",
  IRN: "Flag of Iran.svg",
  IRQ: "Flag of Iraq.svg",
  ITA: "Flag of Italy.svg",
  JOR: "Flag of Jordan.svg",
  JPN: "Flag of Japan.svg",
  KOR: "Flag of South Korea.svg",
  MAR: "Flag of Morocco.svg",
  MEX: "Flag of Mexico.svg",
  NGA: "Flag of Nigeria.svg",
  NLD: "Flag of the Netherlands.svg",
  NOR: "Flag of Norway.svg",
  NZL: "Flag of New Zealand.svg",
  PAN: "Flag of Panama.svg",
  PAR: "Flag of Paraguay.svg",
  PER: "Flag of Peru.svg",
  POL: "Flag of Poland.svg",
  POR: "Flag of Portugal.svg",
  QAT: "Flag of Qatar.svg",
  ROU: "Flag of Romania.svg",
  RSA: "Flag of South Africa.svg",
  RUS: "Flag of Russia.svg",
  SAU: "Flag of Saudi Arabia.svg",
  SCO: "Flag of Scotland.svg",
  SEN: "Flag of Senegal.svg",
  SRB: "Flag of Serbia.svg",
  SWE: "Flag of Sweden.svg",
  TUN: "Flag of Tunisia.svg",
  TUR: "Flag of Turkey.svg",
  UKR: "Flag of Ukraine.svg",
  URY: "Flag of Uruguay.svg",
  USA: "Flag of the United States.svg",
  UZB: "Flag of Uzbekistan.svg",
};

/** The native sprite sizes the scenes draw (see src/flags/sprites.ts). */
const SIZES: Array<[number, number]> = [
  [12, 8],
  [18, 12],
  [24, 16],
  [48, 32],
];

// Tunables for the vote (see header comment).
const RASTER_W = 480; // supersample width; 10× the largest sprite
const MAX_PALETTE = 8; // flags need ≤8 flat colours once simplified
const MIN_SHARE = 0.004; // histogram share below this is AA noise → merged away
const MERGE_DIST = 0.09; // Oklab distance under which two colours are one
const ALPHA = 0.55; // strength of the rarity boost
const RARITY_EPS = 0.02; // stops 1/share exploding for near-absent colours
const MIN_COVERAGE = 0.22; // a colour must hold ≥22% of a cell to win it

// ---------------------------------------------------------------------------
// Colour math — comparisons happen in Oklab so "nearest colour" is perceptual.
// ---------------------------------------------------------------------------
type Lab = [number, number, number];
type RGBv = [number, number, number];

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function oklab(rgb: RGBv): Lab {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labDist(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ---------------------------------------------------------------------------
// Raster + palette
// ---------------------------------------------------------------------------
interface Raster {
  w: number;
  h: number;
  /** Palette index per source pixel. */
  idx: Uint8Array;
  /** Palette colours (sRGB). */
  palette: RGBv[];
}

function rasterize(svg: Buffer): { w: number; h: number; rgb: Uint8Array } {
  const rendered = new Resvg(svg, { fitTo: { mode: "width", value: RASTER_W } }).render();
  const { width: w, height: h } = rendered;
  const px = rendered.pixels;
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    // Composite over white — only edge AA is ever non-opaque in a flag SVG.
    const a = px[i + 3]! / 255;
    rgb[j] = Math.round(px[i]! * a + 255 * (1 - a));
    rgb[j + 1] = Math.round(px[i + 1]! * a + 255 * (1 - a));
    rgb[j + 2] = Math.round(px[i + 2]! * a + 255 * (1 - a));
  }
  return { w, h, rgb };
}

/**
 * Recover the flag's flat palette: histogram on 32-level buckets, largest
 * buckets first, merging anything perceptually close. AA blends are rare and
 * near a real colour, so they either fall under MIN_SHARE or merge away.
 */
function extractPalette(rgb: Uint8Array): RGBv[] {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < rgb.length; i += 3) {
    const key = ((rgb[i]! >> 3) << 10) | ((rgb[i + 1]! >> 3) << 5) | (rgb[i + 2]! >> 3);
    let e = counts.get(key);
    if (!e) counts.set(key, (e = { n: 0, r: 0, g: 0, b: 0 }));
    e.n++;
    e.r += rgb[i]!;
    e.g += rgb[i + 1]!;
    e.b += rgb[i + 2]!;
  }
  const total = rgb.length / 3;
  const buckets = [...counts.values()].sort((a, b) => b.n - a.n);
  const palette: Array<{ c: RGBv; lab: Lab; n: number }> = [];
  for (const e of buckets) {
    const c: RGBv = [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)];
    const lab = oklab(c);
    const near = palette.find((p) => labDist(p.lab, lab) < MERGE_DIST);
    if (near) {
      near.n += e.n; // AA halo or a shade of an accepted colour — absorb it
    } else if (palette.length < MAX_PALETTE && e.n / total >= MIN_SHARE) {
      palette.push({ c, lab, n: e.n });
    }
  }
  return palette.map((p) => p.c);
}

/** Snap every source pixel to its nearest palette colour (perceptually). */
function indexRaster(svg: Buffer): Raster {
  const { w, h, rgb } = rasterize(svg);
  const palette = extractPalette(rgb);
  const labs = palette.map(oklab);
  const idx = new Uint8Array(w * h);
  const memo = new Map<number, number>();
  for (let p = 0, j = 0; p < idx.length; p++, j += 3) {
    const key = (rgb[j]! << 16) | (rgb[j + 1]! << 8) | rgb[j + 2]!;
    let best = memo.get(key);
    if (best === undefined) {
      const lab = oklab([rgb[j]!, rgb[j + 1]!, rgb[j + 2]!]);
      let bd = Infinity;
      best = 0;
      for (let i = 0; i < labs.length; i++) {
        const d = labDist(lab, labs[i]!);
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      memo.set(key, best);
    }
    idx[p] = best;
  }
  return { w, h, idx, palette };
}

// ---------------------------------------------------------------------------
// The salience-weighted vote
// ---------------------------------------------------------------------------
function downscale(src: Raster, W: number, H: number): RGBv[] {
  const n = src.palette.length;
  // Per-cell palette coverage. Source→target mapping stretches the flag's
  // native aspect onto the 3:2 sprite, same as every icon pack does.
  const cov = new Float64Array(W * H * n);
  for (let sy = 0; sy < src.h; sy++) {
    const ty = Math.min(H - 1, Math.floor((sy * H) / src.h));
    for (let sx = 0; sx < src.w; sx++) {
      const tx = Math.min(W - 1, Math.floor((sx * W) / src.w));
      cov[(ty * W + tx) * n + src.idx[sy * src.w + sx]!]++;
    }
  }
  // Normalise cells to fractions.
  for (let c = 0; c < W * H; c++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += cov[c * n + i]!;
    if (sum > 0) for (let i = 0; i < n; i++) cov[c * n + i]! /= sum;
  }
  // Regional share: mean coverage over a window of cells around each cell.
  // This is what makes the boost *local* — leaf-red is boosted inside the
  // white pale but not in Canada's red bands, where it's already dominant.
  const r = Math.max(1, Math.round(Math.min(W, H) / 8));
  const region = new Float64Array(W * H * n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let cells = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          cells++;
          for (let i = 0; i < n; i++) region[(y * W + x) * n + i]! += cov[(yy * W + xx) * n + i]!;
        }
      }
      for (let i = 0; i < n; i++) region[(y * W + x) * n + i]! /= cells;
    }
  }
  // Vote: coverage × rarity boost, among colours with meaningful coverage.
  const out: RGBv[] = new Array(W * H);
  for (let c = 0; c < W * H; c++) {
    let winner = 0;
    let bestCov = -1;
    for (let i = 0; i < n; i++) {
      if (cov[c * n + i]! > bestCov) {
        bestCov = cov[c * n + i]!;
        winner = i;
      }
    }
    let bestScore = -1;
    for (let i = 0; i < n; i++) {
      const coverage = cov[c * n + i]!;
      if (coverage < MIN_COVERAGE) continue;
      const score = coverage * (region[c * n + i]! + RARITY_EPS) ** -ALPHA;
      if (score > bestScore) {
        bestScore = score;
        winner = i;
      }
    }
    out[c] = src.palette[winner]!;
  }
  return out;
}

/** Lift near-black to the DSL's #2C2C2C so dark bands read against unlit LEDs. */
function liftDark(c: RGBv): RGBv {
  if (Math.max(c[0], c[1], c[2]) >= 60) return c;
  return [Math.max(c[0], 44), Math.max(c[1], 44), Math.max(c[2], 44)];
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------
const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const flagsDir = join(pkgDir, "assets", "flags");
const cacheDir = join(flagsDir, ".svg-cache");

function fetchSvg(code: string, force: boolean): Buffer {
  const cached = join(cacheDir, `${code}.svg`);
  if (!force && existsSync(cached)) return readFileSync(cached);
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(SOURCES[code]!)}`;
  // curl (not fetch): it follows the FilePath redirect and honours the proxy
  // environment out of the box on every machine this runs on.
  execFileSync("curl", ["-sfL", "--retry", "3", "-o", cached, url], { stdio: "pipe" });
  const svg = readFileSync(cached);
  if (svg.length < 100 || !svg.subarray(0, 500).toString().includes("<svg")) {
    throw new Error(`downloaded file for ${code} does not look like an SVG`);
  }
  return svg;
}

function writeSprite(code: string, W: number, H: number, pixels: RGBv[]): void {
  const png = new PNG({ width: W, height: H });
  for (let i = 0; i < pixels.length; i++) {
    const [r, g, b] = liftDark(pixels[i]!);
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = 255;
  }
  writeFileSync(join(flagsDir, `${W}x${H}`, `${code}.png`), PNG.sync.write(png));
}

function main(): void {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const only = args.filter((a) => !a.startsWith("--")).map((a) => a.toUpperCase());
  const codes = only.length > 0 ? only : Object.keys(SOURCES);

  mkdirSync(cacheDir, { recursive: true });
  for (const [w, h] of SIZES) mkdirSync(join(flagsDir, `${w}x${h}`), { recursive: true });

  const failed: string[] = [];
  for (const code of codes) {
    if (!SOURCES[code]) {
      console.error(`skip ${code}: no Commons source mapped`);
      failed.push(code);
      continue;
    }
    try {
      const raster = indexRaster(fetchSvg(code, force));
      for (const [w, h] of SIZES) writeSprite(code, w, h, downscale(raster, w, h));
      console.log(`${code}  palette=${raster.palette.length}  (${SOURCES[code]})`);
    } catch (err) {
      console.error(`FAIL ${code}: ${err instanceof Error ? err.message : String(err)}`);
      failed.push(code);
    }
  }
  if (failed.length > 0) {
    console.error(`\n${failed.length} failed: ${failed.join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(`\n${codes.length} flags → ${SIZES.map(([w, h]) => `${w}x${h}`).join(", ")}`);
  }
}

main();
