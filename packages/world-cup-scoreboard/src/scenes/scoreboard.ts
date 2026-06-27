/**
 * The live scoreboard. Stacked layout that reads well on a vertical/near-square
 * panel: home team on the top row, away on the bottom, and a thin status strip
 * between them carrying the minute (with a blinking live dot), HT, FT or stage.
 *
 *   ┌──────────────────────────┐
 *   │ [flag]  ENG          2   │   home row
 *   │ ───────── 67' ● ───────  │   status strip
 *   │ [flag]  FRA          1   │   away row
 *   └──────────────────────────┘
 */
import type { Canvas, RGB } from "../canvas.js";
import { hex } from "../canvas.js";
import { renderFlag } from "../flags/draw.js";
import { flagFor } from "../flags/registry.js";
import { bigDigits, drawText, measure, small } from "../font.js";
import type { Match, SideScore } from "../model.js";

const BG: RGB = hex("#080B14");
const STRIP: RGB = hex("#0E1422");
const INK: RGB = hex("#FFFFFF");
const DIM: RGB = hex("#9AA7BD");
const GOLD: RGB = hex("#FFD24A");
const LIVE: RGB = hex("#FF3B30");

interface Layout {
  rowH: number;
  stripH: number;
  homeY: number;
  stripY: number;
  awayY: number;
}

function layout(h: number): Layout {
  const stripH = Math.max(5, Math.min(7, h - 24));
  const rowH = Math.floor((h - stripH) / 2);
  return { rowH, stripH, homeY: 0, stripY: rowH, awayY: rowH + stripH };
}

/** Draw a flag with a 1px dark frame so light flags don't bleed into the bg. */
function drawFlag(canvas: Canvas, code: string, x: number, y: number, w: number, hh: number): void {
  canvas.fillRect(x - 1, y - 1, w + 2, hh + 2, hex("#1B2233"));
  canvas.draw(renderFlag(flagFor(code), w, hh), x, y);
}

function drawScore(canvas: Canvas, value: number, rightX: number, y: number, color: RGB): void {
  const text = String(value);
  const width = measure(bigDigits, text, 1);
  drawText(canvas, bigDigits, text, rightX - width, y, color);
}

function drawTeamRow(
  canvas: Canvas,
  side: SideScore,
  rowY: number,
  rowH: number,
  win: boolean,
): void {
  // Three columns across the 32px width: flag | code | score, no overlap.
  //   flag  x 1..13   code x 15..25   score x 26..31 (right-aligned)
  const flagH = Math.min(rowH - 2, 11);
  const flagW = 13;
  const flagY = rowY + Math.floor((rowH - flagH) / 2);
  drawFlag(canvas, side.team.code, 1, flagY, flagW, flagH);

  const codeY = rowY + Math.floor((rowH - 5) / 2);
  drawText(canvas, small, side.team.code, 15, codeY, win ? GOLD : INK);

  // Big right-aligned score, gold for the winner at full time.
  const scoreY = rowY + Math.floor((rowH - bigDigits.height) / 2);
  drawScore(canvas, side.score, canvas.width - 1, scoreY, win ? GOLD : INK);
}

function statusLabel(match: Match): string {
  switch (match.status) {
    case "halftime":
      return "HT";
    case "finished":
      return "FT";
    case "live":
      return match.minute != null ? `${match.minute}'` : "LIVE";
    default:
      return match.stage ?? "";
  }
}

/** Render the scoreboard. `t` (seconds) drives the blinking live dot. */
export function drawScoreboard(canvas: Canvas, match: Match, t = 0): void {
  canvas.clear(BG);
  const lo = layout(canvas.height);

  const finished = match.status === "finished";
  const homeWon = finished && match.home.score > match.away.score;
  const awayWon = finished && match.away.score > match.home.score;

  drawTeamRow(canvas, match.home, lo.homeY, lo.rowH, homeWon);
  drawTeamRow(canvas, match.away, lo.awayY, lo.rowH, awayWon);

  // Status strip.
  canvas.fillRect(0, lo.stripY, canvas.width, lo.stripH, STRIP);
  const accent: RGB = match.status === "finished" ? DIM : hex("#FFB020");
  canvas.hLine(0, lo.stripY, canvas.width, accent, 0.5);
  canvas.hLine(0, lo.stripY + lo.stripH - 1, canvas.width, accent, 0.5);

  const label = statusLabel(match);
  const labelW = measure(small, label);
  const live = match.status === "live";
  // Center the label (plus a blinking dot when live) within the strip.
  const dotW = live ? 4 : 0;
  const totalW = labelW + dotW;
  const startX = Math.round((canvas.width - totalW) / 2);
  const textY = lo.stripY + Math.floor((lo.stripH - 5) / 2);
  const end = drawText(
    canvas,
    small,
    label,
    startX,
    textY,
    match.status === "finished" ? DIM : INK,
  );
  if (live) {
    const on = Math.floor(t * 2) % 2 === 0;
    canvas.fillCircle(end + 2, textY + 2, 1.4, on ? LIVE : hex("#5A1410"));
  }
}
