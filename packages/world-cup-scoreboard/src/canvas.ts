/**
 * A tiny RGB framebuffer with just enough drawing primitives to compose a
 * 32x30 scoreboard: filled rects, sprites (with alpha), circles, lines, and a
 * global brightness/dim pass. Everything renders into a flat `Uint8ClampedArray`
 * of `width * height * 3` bytes in **row-major, top-left origin** order — the
 * same logical order WLED's 2D engine expects over DDP (see `ddp.ts`).
 */

export type RGB = readonly [number, number, number];

/** A rectangular bitmap with per-pixel alpha, used for flags and glyphs. */
export interface Sprite {
  readonly width: number;
  readonly height: number;
  /** RGBA, row-major, `width * height * 4` bytes. */
  readonly data: Uint8ClampedArray;
}

export const BLACK: RGB = [0, 0, 0];
export const WHITE: RGB = [255, 255, 255];

/** Parse `#rgb` / `#rrggbb` (or a bare `rrggbb`) into an RGB triple. */
export function hex(value: string): RGB {
  let s = value.trim().replace(/^#/, "");
  if (s.length === 3) s = s[0]! + s[0]! + s[1]! + s[1]! + s[2]! + s[2]!;
  const n = Number.parseInt(s, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Linear blend between two colors, `t` in [0, 1]. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

export function scale(c: RGB, factor: number): RGB {
  return [Math.round(c[0] * factor), Math.round(c[1] * factor), Math.round(c[2] * factor)];
}

export class Canvas {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 3);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  clear(color: RGB = BLACK): void {
    for (let i = 0; i < this.data.length; i += 3) {
      this.data[i] = color[0];
      this.data[i + 1] = color[1];
      this.data[i + 2] = color[2];
    }
  }

  /** Set a pixel, alpha-blending over what's there (`alpha` in [0, 1]). */
  set(x: number, y: number, color: RGB, alpha = 1): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (!this.inside(px, py) || alpha <= 0) return;
    const i = (py * this.width + px) * 3;
    if (alpha >= 1) {
      this.data[i] = color[0];
      this.data[i + 1] = color[1];
      this.data[i + 2] = color[2];
      return;
    }
    this.data[i] = this.data[i]! + (color[0] - this.data[i]!) * alpha;
    this.data[i + 1] = this.data[i + 1]! + (color[1] - this.data[i + 1]!) * alpha;
    this.data[i + 2] = this.data[i + 2]! + (color[2] - this.data[i + 2]!) * alpha;
  }

  get(x: number, y: number): RGB {
    const i = (y * this.width + x) * 3;
    return [this.data[i]!, this.data[i + 1]!, this.data[i + 2]!];
  }

  fillRect(x: number, y: number, w: number, h: number, color: RGB, alpha = 1): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy, color, alpha);
    }
  }

  /** Outlined rectangle (1px). */
  strokeRect(x: number, y: number, w: number, h: number, color: RGB, alpha = 1): void {
    for (let dx = 0; dx < w; dx++) {
      this.set(x + dx, y, color, alpha);
      this.set(x + dx, y + h - 1, color, alpha);
    }
    for (let dy = 0; dy < h; dy++) {
      this.set(x, y + dy, color, alpha);
      this.set(x + w - 1, y + dy, color, alpha);
    }
  }

  hLine(x: number, y: number, w: number, color: RGB, alpha = 1): void {
    for (let dx = 0; dx < w; dx++) this.set(x + dx, y, color, alpha);
  }

  vLine(x: number, y: number, h: number, color: RGB, alpha = 1): void {
    for (let dy = 0; dy < h; dy++) this.set(x, y + dy, color, alpha);
  }

  /** Filled disc centered at (cx, cy). */
  fillCircle(cx: number, cy: number, r: number, color: RGB, alpha = 1): void {
    const r2 = (r + 0.25) * (r + 0.25);
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        if (dx * dx + dy * dy <= r2) this.set(cx + dx, cy + dy, color, alpha);
      }
    }
  }

  /** Blit a sprite at (x, y), respecting per-pixel alpha and an optional opacity. */
  draw(sprite: Sprite, x: number, y: number, opacity = 1): void {
    for (let sy = 0; sy < sprite.height; sy++) {
      for (let sx = 0; sx < sprite.width; sx++) {
        const si = (sy * sprite.width + sx) * 4;
        const a = (sprite.data[si + 3]! / 255) * opacity;
        if (a <= 0) continue;
        this.set(x + sx, y + sy, [sprite.data[si]!, sprite.data[si + 1]!, sprite.data[si + 2]!], a);
      }
    }
  }

  /** Multiply every pixel by `factor` (master brightness / fades). */
  dim(factor: number): void {
    for (let i = 0; i < this.data.length; i++) this.data[i] = this.data[i]! * factor;
  }
}

/** Build a Sprite from a function that returns an RGBA tuple (or null = transparent). */
export function makeSprite(
  width: number,
  height: number,
  paint: (x: number, y: number) => readonly [number, number, number, number] | RGB | null,
): Sprite {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = paint(x, y);
      if (!c) continue;
      const i = (y * width + x) * 4;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = c.length === 4 ? (c[3] as number) : 255;
    }
  }
  return { width, height, data };
}
