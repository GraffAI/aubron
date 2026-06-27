/**
 * The GOAL celebration, themed in the scoring team's colours. Timeline (seconds):
 *
 *   0.00–0.45  white flash that fades out
 *   0.45–end   pulsing two-tone background, big bouncing "GOAL!", and confetti
 *              raining in the team's colours; the team code flickers in below.
 *
 * Deterministic in `t` (no RNG) so the same instant always renders identically —
 * handy for previews and tests.
 */
import type { Canvas, RGB } from "../canvas.js";
import { hex, mix, scale } from "../canvas.js";
import { drawText, measure, small } from "../font.js";
import type { Team } from "../teams.js";

export const GOAL_DURATION = 4.2;

const WHITE: RGB = hex("#FFFFFF");

/** Cheap deterministic hash → [0, 1). */
function rand(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function drawConfetti(canvas: Canvas, t: number, a: RGB, b: RGB): void {
  const count = 46;
  for (let i = 0; i < count; i++) {
    const speed = 6 + rand(i) * 10;
    const x = Math.floor(rand(i * 3 + 1) * canvas.width);
    const drift = Math.sin((t + rand(i)) * 3 + i) * 1.5;
    const y = (rand(i * 7 + 2) * canvas.height + t * speed) % (canvas.height + 4);
    canvas.set(x + drift, y, i % 2 === 0 ? a : b);
  }
}

/** Render one frame of the celebration. `t` is seconds since the goal fired. */
export function drawGoal(canvas: Canvas, team: Team, t: number): void {
  const primary = team.primary;
  const secondary = team.secondary;

  // Pulsing two-tone field.
  const pulse = (Math.sin(t * 7) + 1) / 2;
  const base = mix(scale(primary, 0.35), scale(secondary, 0.55), pulse);
  canvas.clear(base);

  // Sweeping bands of the team colours for energy.
  for (let y = 0; y < canvas.height; y++) {
    const band = Math.sin(y * 0.5 - t * 9);
    if (band > 0.4) canvas.hLine(0, y, canvas.width, scale(primary, 0.6), 0.5);
  }

  drawConfetti(canvas, t, primary, secondary);

  // Big bouncing "GOAL" — scaled small-font, with a 1px shadow for contrast.
  const text = "GOAL";
  const sc = 2;
  const w = measure(small, text, 1) * sc;
  const x = Math.round((canvas.width - w) / 2);
  const bounce = Math.round(Math.abs(Math.sin(t * 6)) * 2);
  const baseY = Math.round(canvas.height * 0.28) - bounce;
  drawText(canvas, small, text, x + 1, baseY + 1, hex("#000000"), { scale: sc, alpha: 0.6 });
  const flicker = Math.floor(t * 12) % 6 === 0 ? mix(WHITE, primary, 0.4) : WHITE;
  drawText(canvas, small, text, x, baseY, flicker, { scale: sc });

  // Scoring team code below.
  const codeY = Math.round(canvas.height * 0.62);
  drawText(canvas, small, team.code, Math.round(canvas.width / 2), codeY, WHITE, {
    center: true,
    scale: 1,
  });

  // Opening white flash.
  if (t < 0.45) fadeWhite(canvas, 1 - t / 0.45);
}

function fadeWhite(canvas: Canvas, amount: number): void {
  for (let i = 0; i < canvas.data.length; i += 3) {
    canvas.data[i] = canvas.data[i]! + (255 - canvas.data[i]!) * amount;
    canvas.data[i + 1] = canvas.data[i + 1]! + (255 - canvas.data[i + 1]!) * amount;
    canvas.data[i + 2] = canvas.data[i + 2]! + (255 - canvas.data[i + 2]!) * amount;
  }
}
