/**
 * Calibration patterns for dialing in the matrix mapping/orientation against an
 * unknown panel (a converted Govee curtain can be wired in surprising orders).
 *
 *   - `axes`   white origin (0,0), red top row, green left column → reveals
 *              orientation and where the origin actually is.
 *   - `border` 1px frame → confirms width/height and edges.
 *   - `fill`   dim white everywhere → confirms every LED is alive.
 *   - single pixel walk → light one logical index at a time to build a ledmap.
 */
import type { Canvas } from "../canvas.js";

export function drawAxes(canvas: Canvas): void {
  canvas.clear([0, 0, 0]);
  canvas.hLine(0, 0, canvas.width, [180, 0, 0]); // top row red
  canvas.vLine(0, 0, canvas.height, [0, 150, 0]); // left column green
  canvas.set(0, 0, [255, 255, 255]); // origin white
  // A short blue stub along the top row marks increasing x direction.
  canvas.hLine(0, 1, Math.min(5, canvas.width), [0, 60, 200]);
}

export function drawBorder(canvas: Canvas): void {
  canvas.clear([0, 0, 0]);
  canvas.strokeRect(0, 0, canvas.width, canvas.height, [120, 120, 160]);
}

export function drawFill(canvas: Canvas, level = 40): void {
  canvas.clear([level, level, level]);
}

/** Light a single logical pixel (for the index→(x,y) walk). */
export function drawSinglePixel(canvas: Canvas, index: number): void {
  canvas.clear([0, 0, 0]);
  const x = index % canvas.width;
  const y = Math.floor(index / canvas.width);
  canvas.set(x, y, [255, 255, 255]);
}
