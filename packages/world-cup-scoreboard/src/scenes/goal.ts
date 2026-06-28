/**
 * The GOAL celebration, themed in the scoring team's colours. Timeline (seconds):
 *
 *   0.00–0.40  white flash that fades out
 *   0.40–end   black background, big "GOAL!" in the team's brightest colour, the
 *              scoring team's flag centred, and confetti raining in team colours.
 *
 * Black background (not a coloured field) so the text and flag stay crisp — the
 * colour identity comes from the text + flag, not a wash that swallows them.
 *
 * Deterministic in `t` (no RNG) so the same instant always renders identically —
 * handy for previews and tests.
 */
import type { Canvas, RGB } from "../canvas.js";
import { flagSprite } from "../flags/sprites.js";
import { drawText, small } from "../font.js";
import type { Team } from "../teams.js";

/**
 * How long the celebration holds on screen. Kept generous on purpose: casting
 * the horn to a Chromecast has a few seconds of connect/buffer latency, so the
 * celebration should still be up when the sound finally lands.
 */
export const GOAL_DURATION = 7;

const BLACK: RGB = [0, 0, 0];

function luma(c: RGB): number {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}

/** Cheap deterministic hash → [0, 1). */
function rand(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function drawConfetti(canvas: Canvas, t: number, a: RGB, b: RGB): void {
  const count = 38;
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
  // Opening white flash: a full-panel pop that fades to black, then the tableau.
  if (t < 0.4) {
    const v = Math.round(255 * (1 - t / 0.4));
    canvas.clear([v, v, v]);
    return;
  }

  canvas.clear(BLACK);

  // Pick the brighter of the team's two colours for the text so it always reads
  // against black; the other becomes a drop-shadow accent for a little depth.
  const bright = luma(team.primary) >= luma(team.secondary) ? team.primary : team.secondary;
  const accent = bright === team.primary ? team.secondary : team.primary;

  // Confetti behind everything, in the team colours.
  drawConfetti(canvas, t, team.primary, team.secondary);

  // The scoring team's flag as a 24×16 hero, centred below the title — big
  // enough to carry the identity, so no separate code is needed.
  const fw = 24;
  const fh = 16;
  const fx = Math.round((canvas.width - fw) / 2);
  const fy = 13;
  canvas.draw(flagSprite(team.code, fw, fh), fx, fy);

  // "GOAL" across the top, with a tiny bounce, in the bright team colour over an
  // accent-coloured shadow so it pops off the flag/confetti.
  const label = "GOAL";
  const sc = 2;
  const gx = Math.round(canvas.width / 2);
  const bounce = Math.round(Math.abs(Math.sin(t * 6)) * 1.5);
  const gy = 1 + bounce;
  drawText(canvas, small, label, gx + 1, gy + 1, accent, { center: true, scale: sc });
  drawText(canvas, small, label, gx, gy, bright, { center: true, scale: sc });
}
