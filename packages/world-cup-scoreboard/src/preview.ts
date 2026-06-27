/**
 * Off-device preview: encode a `Canvas` to a PNG that simulates the physical
 * matrix (round "LEDs" on black, scaled up), so the look can be validated by eye
 * without the hardware. Also tiles several canvases into one contact sheet.
 *
 * Used by the `preview` CLI subcommand and handy in tests/dev.
 */
import { PNG } from "pngjs";

import type { Canvas, RGB } from "./canvas.js";
import { Canvas as Fb } from "./canvas.js";

export interface PngOptions {
  /** Pixels per LED in the output image. */
  scale?: number;
  /** Draw round LEDs on black (true) or flat squares (false). */
  led?: boolean;
}

/** Encode a canvas to a PNG buffer. */
export function toPng(canvas: Canvas, opts: PngOptions = {}): Buffer {
  const scale = opts.scale ?? 14;
  const led = opts.led ?? true;
  const W = canvas.width * scale;
  const H = canvas.height * scale;
  const png = new PNG({ width: W, height: H });

  // Background: near-black so unlit LEDs read as off.
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 8;
    png.data[i + 1] = 8;
    png.data[i + 2] = 10;
    png.data[i + 3] = 255;
  }

  const r = (scale / 2) * 0.82;
  const r2 = r * r;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const c = canvas.get(x, y);
      const cx = x * scale + scale / 2;
      const cy = y * scale + scale / 2;
      for (let py = y * scale; py < (y + 1) * scale; py++) {
        for (let px = x * scale; px < (x + 1) * scale; px++) {
          if (led) {
            const d2 = (px + 0.5 - cx) ** 2 + (py + 0.5 - cy) ** 2;
            if (d2 > r2) continue;
            // Soft falloff toward the LED edge for a nicer glow.
            const k = 1 - (d2 / r2) * 0.35;
            putPx(png, px, py, c, k);
          } else {
            putPx(png, px, py, c, 1);
          }
        }
      }
    }
  }
  return PNG.sync.write(png);
}

function putPx(png: PNG, x: number, y: number, c: RGB, k: number): void {
  const i = (png.width * y + x) * 4;
  png.data[i] = Math.max(png.data[i]!, Math.round(c[0] * k));
  png.data[i + 1] = Math.max(png.data[i + 1]!, Math.round(c[1] * k));
  png.data[i + 2] = Math.max(png.data[i + 2]!, Math.round(c[2] * k));
  png.data[i + 3] = 255;
}

/**
 * Tile canvases (all the same size) into a single grid canvas with gaps, so a
 * whole storyboard fits in one preview image.
 */
export function tile(canvases: Canvas[], cols: number, gap = 2): Canvas {
  if (canvases.length === 0) return new Fb(1, 1);
  const cw = canvases[0]!.width;
  const ch = canvases[0]!.height;
  const rows = Math.ceil(canvases.length / cols);
  const out = new Fb(cols * cw + (cols + 1) * gap, rows * ch + (rows + 1) * gap);
  out.clear([20, 22, 28]);
  canvases.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const ox = gap + col * (cw + gap);
    const oy = gap + row * (ch + gap);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) out.set(ox + x, oy + y, c.get(x, y));
  });
  return out;
}
