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
import { flagSprite } from "../flags/sprites.js";
import { bigDigits, drawText, measure, small } from "../font.js";
import type { Match, SideScore } from "../model.js";

const BG: RGB = [0, 0, 0];
const INK: RGB = hex("#FFFFFF");
const DIM: RGB = hex("#9AA7BD");
const GOLD: RGB = hex("#FFD24A");

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

/** Draw a flag. Against the black background each flag's own pixels are its edges. */
function drawFlag(canvas: Canvas, code: string, x: number, y: number, w: number, hh: number): void {
  canvas.draw(flagSprite(code, w, hh), x, y);
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
  // A tall 18×12 flag fills the row and carries the team identity (no code),
  // with the big score right-aligned to the panel edge. Both flags sit snug to
  // the status strip, leaving the bottom row free for the rotation pager.
  const flagH = 12;
  const flagW = 18;
  const flagY = rowY + Math.floor((rowH - flagH) / 2);
  drawFlag(canvas, side.team.code, 0, flagY, flagW, flagH);

  const scoreY = rowY + Math.floor((rowH - bigDigits.height) / 2);
  drawScore(canvas, side.score, canvas.width, scoreY, win ? GOLD : INK);
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

/**
 * Render the scoreboard. `clock` overrides the status-strip label — the engine
 * passes a ticking "68:24" (or "45+2" in stoppage) for live matches; otherwise
 * the HT / FT / minute label is derived from the match.
 */
export function drawScoreboard(canvas: Canvas, match: Match, clock?: string): void {
  canvas.clear(BG);
  const lo = layout(canvas.height);

  const finished = match.status === "finished";
  const homeWon = finished && match.home.score > match.away.score;
  const awayWon = finished && match.away.score > match.home.score;

  drawTeamRow(canvas, match.home, lo.homeY, lo.rowH, homeWon);
  drawTeamRow(canvas, match.away, lo.awayY, lo.rowH, awayWon);

  // Status strip: two crisp divider lines bracket the clock/label. No dim fill —
  // the gap between them stays truly off rather than glowing.
  const accent: RGB = finished ? DIM : hex("#FFB020");
  canvas.hLine(0, lo.stripY, canvas.width, accent);
  canvas.hLine(0, lo.stripY + lo.stripH - 1, canvas.width, accent);

  // FT/HT/clock label. Finished uses gold (strong against the dim FT borders);
  // live/HT stay white.
  const label = clock ?? statusLabel(match);
  const textY = lo.stripY + Math.floor((lo.stripH - 5) / 2);
  drawText(canvas, small, label, Math.round(canvas.width / 2), textY, finished ? GOLD : INK, {
    center: true,
  });
}
