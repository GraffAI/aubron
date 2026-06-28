/**
 * Maps the logical 2D canvas (row-major, top-left origin) onto the physical LED
 * order the controller expects.
 *
 * Two strategies (see DDP research):
 *
 *   - `wled` (recommended): configure the 30x32 matrix + serpentine in WLED's
 *     own 2D settings and stream logical `i = y*width + x`. WLED's ledmap remaps
 *     to the Govee wiring at show() time, so this module emits identity order.
 *   - `vertical` / `horizontal`: WLED is a plain 1D strip and *we* remap. Govee
 *     curtains are almost always **column-wise serpentine** (data runs down one
 *     strand, up the next), which is `layout: "vertical", serpentine: true`.
 *
 * Calibrate an unknown panel with the `calibrate` walk (one lit pixel at a time).
 */
export type Layout = "wled" | "horizontal" | "vertical";

export interface MatrixConfig {
  width: number;
  height: number;
  layout: Layout;
  /** Boustrophedon wiring: alternate rows/columns run in reverse. */
  serpentine: boolean;
  flipX: boolean;
  flipY: boolean;
}

export const DEFAULT_MATRIX: MatrixConfig = {
  width: 30,
  height: 32,
  layout: "wled",
  serpentine: true,
  flipX: false,
  flipY: false,
};

/**
 * Build the pixel order: `order[p]` is the logical canvas index (`y*width + x`)
 * whose colour belongs at physical LED position `p`. For `layout: "wled"` this
 * is the identity (WLED does the remap).
 */
export function buildPixelOrder(cfg: MatrixConfig): Int32Array {
  const { width: w, height: h } = cfg;
  const order = new Int32Array(w * h);

  if (cfg.layout === "wled") {
    for (let i = 0; i < order.length; i++) order[i] = i;
    return order;
  }

  let p = 0;
  if (cfg.layout === "horizontal") {
    for (let row = 0; row < h; row++) {
      const y = cfg.flipY ? h - 1 - row : row;
      const reverse = cfg.serpentine && row % 2 === 1;
      for (let col = 0; col < w; col++) {
        const xRaw = reverse ? w - 1 - col : col;
        const x = cfg.flipX ? w - 1 - xRaw : xRaw;
        order[p++] = y * w + x;
      }
    }
  } else {
    // vertical: physical index advances down a column/strand, then the next.
    for (let col = 0; col < w; col++) {
      const x = cfg.flipX ? w - 1 - col : col;
      const reverse = cfg.serpentine && col % 2 === 1;
      for (let rowI = 0; rowI < h; rowI++) {
        const yRaw = reverse ? h - 1 - rowI : rowI;
        const y = cfg.flipY ? h - 1 - yRaw : yRaw;
        order[p++] = y * w + x;
      }
    }
  }
  return order;
}

const lutCache = new Map<string, Uint8Array>();

/**
 * A 256-entry tone curve combining gamma and brightness. Raw 8-bit sRGB values
 * sent straight to LEDs look washed/pastel (especially greens); a gamma > 1
 * deepens the lows, restoring saturation and contrast. `gamma = 1` is a no-op.
 */
export function toneLut(gamma: number, brightness = 1): Uint8Array {
  const key = `${gamma}|${brightness}`;
  const cached = lutCache.get(key);
  if (cached) return cached;
  const b = Math.max(0, Math.min(1, brightness));
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round(Math.pow(v / 255, gamma) * b * 255);
  lutCache.set(key, lut);
  return lut;
}

/**
 * Serialize a canvas's RGB into physical-LED order as a flat byte stream
 * (3 bytes/LED). `rgb` is the canvas's row-major buffer; `order` comes from
 * `buildPixelOrder`. Each channel is passed through the gamma/brightness curve.
 */
export function serializeFrame(
  rgb: Uint8ClampedArray,
  order: Int32Array,
  brightness = 1,
  gamma = 1,
): Uint8Array {
  const out = new Uint8Array(order.length * 3);
  const lut = toneLut(gamma, brightness);
  for (let p = 0; p < order.length; p++) {
    const src = order[p]! * 3;
    const dst = p * 3;
    out[dst] = lut[rgb[src]!]!;
    out[dst + 1] = lut[rgb[src + 1]!]!;
    out[dst + 2] = lut[rgb[src + 2]!]!;
  }
  return out;
}
