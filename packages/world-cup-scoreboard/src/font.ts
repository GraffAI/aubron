/**
 * Hand-drawn bitmap fonts. At 32x30 a normal vector font is illegible, so we
 * ship two fixed-cell pixel fonts:
 *
 *   - `small` (3x5): uppercase A-Z, 0-9 and a little punctuation — used for
 *     country codes (ENG, BRA…), the match minute and status labels.
 *   - `bigDigits` (6x9): bold 0-9 only — used for the score numbers.
 *
 * Glyphs are authored as rows of `#`/space strings so they're easy to eyeball
 * and tweak; `compile()` turns them into a fast lookup at module load.
 */
import type { Canvas, RGB } from "./canvas.js";

export interface Font {
  readonly width: number;
  readonly height: number;
  readonly glyphs: Readonly<Record<string, readonly string[]>>;
}

// prettier-ignore
const SMALL: Record<string, string[]> = {
  "0": ["###","# #","# #","# #","###"],
  "1": [" # ","## "," # "," # ","###"],
  "2": ["###","  #","###","#  ","###"],
  "3": ["###","  #","###","  #","###"],
  "4": ["# #","# #","###","  #","  #"],
  "5": ["###","#  ","###","  #","###"],
  "6": ["###","#  ","###","# #","###"],
  "7": ["###","  #","  #","  #","  #"],
  "8": ["###","# #","###","# #","###"],
  "9": ["###","# #","###","  #","###"],
  A: ["###","# #","###","# #","# #"],
  B: ["## ","# #","## ","# #","## "],
  C: ["###","#  ","#  ","#  ","###"],
  D: ["## ","# #","# #","# #","## "],
  E: ["###","#  ","###","#  ","###"],
  F: ["###","#  ","###","#  ","#  "],
  G: ["###","#  ","# #","# #","###"],
  H: ["# #","# #","###","# #","# #"],
  I: ["###"," # "," # "," # ","###"],
  J: ["  #","  #","  #","# #","###"],
  K: ["# #","# #","## ","# #","# #"],
  L: ["#  ","#  ","#  ","#  ","###"],
  M: ["#   #","## ##","# # #","#   #","#   #"],
  N: ["#  #","## #","# ##","#  #","#  #"],
  O: ["###","# #","# #","# #","###"],
  P: ["###","# #","###","#  ","#  "],
  Q: ["###","# #","# #","###","  #"],
  R: ["###","# #","## ","# #","# #"],
  S: ["###","#  ","###","  #","###"],
  T: ["###"," # "," # "," # "," # "],
  U: ["# #","# #","# #","# #","###"],
  V: ["# #","# #","# #","# #"," # "],
  W: ["#   #","#   #","# # #","## ##","#   #"],
  X: ["# #","# #"," # ","# #","# #"],
  Y: ["# #","# #"," # "," # "," # "],
  Z: ["###","  #"," # ","#  ","###"],
  " ": ["   ","   ","   ","   ","   "],
  ":": ["   "," # ","   "," # ","   "],
  "-": ["   ","   ","###","   ","   "],
  "'": [" # "," # ","   ","   ","   "],
  ".": ["   ","   ","   ","   "," # "],
  "/": ["  #","  #"," # ","#  ","#  "],
};

// prettier-ignore
const BIG_DIGITS: Record<string, string[]> = {
  "0": [" #### ","##  ##","##  ##","##  ##","##  ##","##  ##","##  ##","##  ##"," #### "],
  "1": ["  ##  "," ###  ","  ##  ","  ##  ","  ##  ","  ##  ","  ##  ","  ##  ","######"],
  "2": [" #### ","##  ##","    ##","   ## ","  ##  "," ##   ","##    ","##    ","######"],
  "3": [" #### ","##  ##","    ##","   ## ","  ### ","   ## ","    ##","##  ##"," #### "],
  "4": ["##  ##","##  ##","##  ##","##  ##","######","    ##","    ##","    ##","    ##"],
  "5": ["######","##    ","##    ","##    ","##### ","    ##","    ##","##  ##"," #### "],
  "6": [" #### ","##  ##","##    ","##    ","##### ","##  ##","##  ##","##  ##"," #### "],
  "7": ["######","    ##","    ##","   ## ","  ##  ","  ##  "," ##   "," ##   "," ##   "],
  "8": [" #### ","##  ##","##  ##","##  ##"," #### ","##  ##","##  ##","##  ##"," #### "],
  "9": [" #### ","##  ##","##  ##","##  ##"," #####","    ##","    ##","##  ##"," #### "],
};

function compile(width: number, height: number, src: Record<string, string[]>): Font {
  return { width, height, glyphs: src };
}

export const small = compile(3, 5, SMALL);
export const bigDigits = compile(6, 9, BIG_DIGITS);

/** Width in pixels that `text` will occupy in `font` with the given letter spacing. */
/** Pixel width of a single glyph (glyphs may be wider than the nominal cell). */
function glyphWidth(font: Font, ch: string): number {
  const glyph = font.glyphs[ch] ?? font.glyphs[" "];
  return glyph?.[0]?.length ?? font.width;
}

/** Width in pixels that `text` occupies, summing each (possibly wider) glyph. */
export function measure(font: Font, text: string, spacing = 1): number {
  const upper = text.toUpperCase();
  if (upper.length === 0) return 0;
  let w = 0;
  for (let i = 0; i < upper.length; i++) {
    w += glyphWidth(font, upper[i]!);
    if (i < upper.length - 1) w += spacing;
  }
  return w;
}

export interface TextOptions {
  spacing?: number;
  alpha?: number;
  /** Draw text centered horizontally on `x` instead of left-aligned at `x`. */
  center?: boolean;
  /** Integer pixel-doubling factor (1 = native cell size). */
  scale?: number;
}

/** Draw `text` and return the x just past the last glyph. */
export function drawText(
  canvas: Canvas,
  font: Font,
  text: string,
  x: number,
  y: number,
  color: RGB,
  opts: TextOptions = {},
): number {
  const spacing = opts.spacing ?? 1;
  const alpha = opts.alpha ?? 1;
  const scale = Math.max(1, Math.round(opts.scale ?? 1));
  const upper = text.toUpperCase();
  let cx = opts.center ? Math.round(x - (measure(font, upper, spacing) * scale) / 2) : x;
  for (const ch of upper) {
    const glyph = font.glyphs[ch] ?? font.glyphs[" "];
    if (glyph) {
      for (let row = 0; row < glyph.length; row++) {
        const line = glyph[row]!;
        for (let col = 0; col < line.length; col++) {
          if (line[col] === " ") continue;
          for (let sy = 0; sy < scale; sy++)
            for (let sx = 0; sx < scale; sx++)
              canvas.set(cx + col * scale + sx, y + row * scale + sy, color, alpha);
        }
      }
    }
    cx += (glyphWidth(font, ch) + spacing) * scale;
  }
  return cx - spacing * scale;
}
