/**
 * Pre-match card shown when the next World Cup fixture is scheduled soon: both
 * flags with their codes, a "VS" between them, and a countdown to kickoff.
 */
import type { Canvas, RGB } from "../canvas.js";
import { hex } from "../canvas.js";
import { flagSprite } from "../flags/sprites.js";
import { drawText, small } from "../font.js";
import type { Match } from "../model.js";

const BG: RGB = [0, 0, 0];
const INK: RGB = hex("#E8EDF7");
const ACCENT: RGB = hex("#FFB020");

function flag(canvas: Canvas, code: string, x: number, y: number, w: number, h: number): void {
  canvas.draw(flagSprite(code, w, h), x, y);
}

/** Minutes-to-kickoff label, e.g. "IN 23M" / "IN 2H" / "KICKOFF". */
function countdown(kickoff: string | undefined, now: Date): string {
  if (!kickoff) return "SOON";
  const mins = Math.round((new Date(kickoff).getTime() - now.getTime()) / 60000);
  if (mins <= 0) return "KICKOFF";
  if (mins < 60) return `IN ${mins}M`;
  return `IN ${Math.round(mins / 60)}H`;
}

export function drawKickoff(canvas: Canvas, match: Match, now: Date): void {
  canvas.clear(BG);
  const w = canvas.width;

  if (match.stage) {
    drawText(canvas, small, match.stage, Math.round(w / 2), 1, ACCENT, { center: true });
  }

  // Two flags side by side near the top (12×8 native sprite size).
  const fw = 12;
  const fh = 8;
  const top = 8;
  flag(canvas, match.home.team.code, 2, top, fw, fh);
  flag(canvas, match.away.team.code, w - fw - 2, top, fw, fh);

  // Codes under each flag.
  drawText(canvas, small, match.home.team.code, 2 + Math.floor(fw / 2), top + fh + 2, INK, {
    center: true,
  });
  drawText(
    canvas,
    small,
    match.away.team.code,
    w - fw - 2 + Math.floor(fw / 2),
    top + fh + 2,
    INK,
    {
      center: true,
    },
  );

  // Countdown at the bottom.
  drawText(
    canvas,
    small,
    countdown(match.kickoff, now),
    Math.round(w / 2),
    canvas.height - 6,
    ACCENT,
    {
      center: true,
    },
  );
}
