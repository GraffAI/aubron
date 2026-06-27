/**
 * A miniature flag-drawing DSL. Real flag artwork is unreadable at ~14x10px, so
 * each flag is described as an ordered list of `Layer`s (bands, a cross, a disc,
 * a star…) that paint into an opaque RGBA buffer. This keeps every nation a few
 * lines of data (see `registry.ts`) instead of bespoke pixel art, and renders
 * crisply at any small size.
 */
import type { RGB, Sprite } from "../canvas.js";
import { hex } from "../canvas.js";

export type Color = string | RGB;

export type Layer =
  | { kind: "fill"; color: Color }
  /** Equal (or `weights`-proportioned) stripes, vertical or horizontal. */
  | { kind: "bands"; dir: "v" | "h"; colors: Color[]; weights?: number[] }
  /** Rect in fractional coords (0..1). */
  | { kind: "rect"; x: number; y: number; w: number; h: number; color: Color }
  /** Disc; center + radius as fractions of the smaller dimension. */
  | { kind: "disc"; cx: number; cy: number; r: number; color: Color }
  | { kind: "ring"; cx: number; cy: number; r: number; t: number; color: Color }
  /** Half disc (taegeuk-style); `half` picks which side is filled. */
  | { kind: "halfDisc"; cx: number; cy: number; r: number; color: Color; half: "top" | "bottom" }
  /** Upright cross; `ox`/`oy` fractional center (Nordic crosses sit left). */
  | { kind: "cross"; color: Color; t: number; ox?: number; oy?: number }
  | { kind: "saltire"; color: Color; t: number }
  /** Centered rhombus (Brazil). `s` scales the half-extents. */
  | { kind: "diamond"; color: Color; s: number }
  /** Filled N-point star at fractional center, radius as fraction of min dim. */
  | { kind: "star"; cx: number; cy: number; r: number; color: Color; points?: number; rot?: number }
  /** Small checkerboard block (Croatia). */
  | {
      kind: "checker";
      x: number;
      y: number;
      w: number;
      h: number;
      cols: number;
      rows: number;
      a: Color;
      b: Color;
    };

export interface FlagSpec {
  /** Aspect hint (width:height). Most flags are 3:2; we still letterbox to fit. */
  readonly ratio?: number;
  readonly layers: Layer[];
}

function rgb(c: Color): RGB {
  return typeof c === "string" ? hex(c) : c;
}

class Buf {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  px(x: number, y: number, c: RGB, a = 1): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h || a <= 0) return;
    const i = (iy * this.w + ix) * 4;
    if (a >= 1) {
      this.data[i] = c[0];
      this.data[i + 1] = c[1];
      this.data[i + 2] = c[2];
      this.data[i + 3] = 255;
      return;
    }
    const inv = 1 - a;
    this.data[i] = this.data[i]! * inv + c[0] * a;
    this.data[i + 1] = this.data[i + 1]! * inv + c[1] * a;
    this.data[i + 2] = this.data[i + 2]! * inv + c[2] * a;
    this.data[i + 3] = 255;
  }
  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) this.px(x + dx, y + dy, c);
  }
}

function polygon(
  cx: number,
  cy: number,
  pts: Array<[number, number]>,
): (x: number, y: number) => boolean {
  return (x, y) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]!;
      const [xj, yj] = pts[j]!;
      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    void cx;
    void cy;
    return inside;
  };
}

function starPoints(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  n: number,
  rot: number,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (Math.PI * i) / n;
    pts.push([cx + r * Math.sin(a), cy - r * Math.cos(a)]);
  }
  return pts;
}

function paintLayer(buf: Buf, layer: Layer): void {
  const { w, h } = buf;
  const min = Math.min(w, h);
  switch (layer.kind) {
    case "fill":
      buf.rect(0, 0, w, h, rgb(layer.color));
      return;
    case "bands": {
      const weights = layer.weights ?? layer.colors.map(() => 1);
      const total = weights.reduce((a, b) => a + b, 0);
      const span = layer.dir === "v" ? w : h;
      let pos = 0;
      for (let i = 0; i < layer.colors.length; i++) {
        const size = (weights[i]! / total) * span;
        const c = rgb(layer.colors[i]!);
        if (layer.dir === "v") buf.rect(Math.round(pos), 0, Math.ceil(size), h, c);
        else buf.rect(0, Math.round(pos), w, Math.ceil(size), c);
        pos += size;
      }
      return;
    }
    case "rect":
      buf.rect(layer.x * w, layer.y * h, layer.w * w, layer.h * h, rgb(layer.color));
      return;
    case "disc": {
      const c = rgb(layer.color);
      const cx = layer.cx * w;
      const cy = layer.cy * h;
      const r = layer.r * min;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) buf.px(x, y, c);
      return;
    }
    case "ring": {
      const c = rgb(layer.color);
      const cx = layer.cx * w;
      const cy = layer.cy * h;
      const r = layer.r * min;
      const inner = (layer.r - layer.t) * min;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const d2 = (x - cx) ** 2 + (y - cy) ** 2;
          if (d2 <= r * r && d2 >= inner * inner) buf.px(x, y, c);
        }
      return;
    }
    case "halfDisc": {
      const c = rgb(layer.color);
      const cx = layer.cx * w;
      const cy = layer.cy * h;
      const r = layer.r * min;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
          if (layer.half === "top" && y <= cy) buf.px(x, y, c);
          if (layer.half === "bottom" && y >= cy) buf.px(x, y, c);
        }
      return;
    }
    case "cross": {
      const c = rgb(layer.color);
      const t = layer.t * min;
      const ox = (layer.ox ?? 0.5) * w;
      const oy = (layer.oy ?? 0.5) * h;
      buf.rect(0, oy - t / 2, w, t, c);
      buf.rect(ox - t / 2, 0, t, h, c);
      return;
    }
    case "saltire": {
      const c = rgb(layer.color);
      const t = layer.t * min;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const u = (x / w) * h;
          if (Math.abs(u - y) <= t / 2 || Math.abs(u - (h - y)) <= t / 2) buf.px(x, y, c);
        }
      return;
    }
    case "diamond": {
      const c = rgb(layer.color);
      const cx = w / 2;
      const cy = h / 2;
      const ex = (w / 2) * layer.s;
      const ey = (h / 2) * layer.s;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
          if (Math.abs(x - cx) / ex + Math.abs(y - cy) / ey <= 1) buf.px(x, y, c);
      return;
    }
    case "star": {
      const c = rgb(layer.color);
      const cx = layer.cx * w;
      const cy = layer.cy * h;
      const outer = layer.r * min;
      const pts = starPoints(cx, cy, outer, outer * 0.42, layer.points ?? 5, layer.rot ?? 0);
      const test = polygon(cx, cy, pts);
      for (let y = Math.floor(cy - outer); y <= Math.ceil(cy + outer); y++)
        for (let x = Math.floor(cx - outer); x <= Math.ceil(cx + outer); x++)
          if (test(x, y)) buf.px(x, y, c);
      return;
    }
    case "checker": {
      const a = rgb(layer.a);
      const b = rgb(layer.b);
      const cw = (layer.w * w) / layer.cols;
      const ch = (layer.h * h) / layer.rows;
      for (let r = 0; r < layer.rows; r++)
        for (let cl = 0; cl < layer.cols; cl++)
          buf.rect(
            layer.x * w + cl * cw,
            layer.y * h + r * ch,
            Math.ceil(cw),
            Math.ceil(ch),
            (cl + r) % 2 === 0 ? a : b,
          );
      return;
    }
  }
}

/** Render a flag spec into an opaque sprite of the requested pixel size. */
export function renderFlag(spec: FlagSpec, width: number, height: number): Sprite {
  const buf = new Buf(width, height);
  for (const layer of spec.layers) paintLayer(buf, layer);
  return { width, height, data: buf.data };
}
