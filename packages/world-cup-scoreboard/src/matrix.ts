/**
 * Maps the logical 2D canvas (row-major, top-left origin) onto the physical LED
 * order the controller expects.
 *
 * Two strategies (see DDP research):
 *
 *   - `wled` (recommended): configure the 32x30 matrix + serpentine in WLED's
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
  width: 32,
  height: 30,
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

/**
 * Serialize a canvas's RGB into physical-LED order as a flat byte stream
 * (3 bytes/LED). `rgb` is the canvas's row-major buffer; `order` comes from
 * `buildPixelOrder`. `brightness` (0..1) scales every channel.
 */
export function serializeFrame(
  rgb: Uint8ClampedArray,
  order: Int32Array,
  brightness = 1,
): Uint8Array {
  const out = new Uint8Array(order.length * 3);
  const b = Math.max(0, Math.min(1, brightness));
  for (let p = 0; p < order.length; p++) {
    const src = order[p]! * 3;
    const dst = p * 3;
    out[dst] = rgb[src]! * b;
    out[dst + 1] = rgb[src + 1]! * b;
    out[dst + 2] = rgb[src + 2]! * b;
  }
  return out;
}
