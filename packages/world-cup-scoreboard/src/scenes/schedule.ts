/**
 * Idle "what's on" ticker. When no match is live, scroll through the day's
 * remaining fixtures — each a stacked pair of flags with the kickoff time in
 * Pacific. If nothing's left today, roll over to tomorrow's card.
 *
 * Legibility experiment: each team's code is knocked out of its flag as *off*
 * LEDs (negative space) rather than printed beside it — the flag is the label.
 *
 * `selectFixtures` is pure (no rendering) so the day-rollover logic is unit
 * tested without a canvas.
 */
import type { Canvas, RGB } from "../canvas.js";
import { flagSprite } from "../flags/sprites.js";
import { drawText, measure, small } from "../font.js";
import { isActive, type Match } from "../model.js";

const BLACK: RGB = [0, 0, 0];

const TZ = "America/Los_Angeles";
const DAY_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** Pacific calendar day, "YYYY-MM-DD", for grouping fixtures by local date. */
function pstDay(d: Date): string {
  return DAY_FMT.format(d);
}

/** Compact Pacific kickoff time, e.g. "4:30P". */
export function pstTime(d: Date): string {
  const parts = TIME_FMT.formatToParts(d);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const period = get("dayPeriod").toUpperCase().startsWith("P") ? "P" : "A";
  return `${get("hour")}:${get("minute")}${period}`;
}

export interface Fixtures {
  day: "TODAY" | "TOMORROW";
  list: Match[];
}

/**
 * The fixtures worth idling on: today's still-to-come (or in-progress) matches,
 * or — if today is done — tomorrow's, both in Pacific time and kickoff order.
 */
export function selectFixtures(matches: Match[], now: Date): Fixtures {
  const onDay = (m: Match, day: string): boolean =>
    m.kickoff != null && pstDay(new Date(m.kickoff)) === day;
  const byKickoff = (a: Match, b: Match): number =>
    new Date(a.kickoff ?? 0).getTime() - new Date(b.kickoff ?? 0).getTime();

  const today = pstDay(now);
  const remaining = matches
    .filter((m) => (m.status === "scheduled" || isActive(m.status)) && onDay(m, today))
    .sort(byKickoff);
  if (remaining.length > 0) return { day: "TODAY", list: remaining };

  const tomorrow = pstDay(new Date(now.getTime() + 86_400_000));
  const next = matches
    .filter((m) => m.status === "scheduled" && onDay(m, tomorrow))
    .sort(byKickoff);
  return { day: "TOMORROW", list: next };
}

/**
 * Draw a flag with its 3-letter code knocked out as off (black) pixels. The cut
 * is only applied when the code leaves a ≥1px lit margin on every side, so the
 * letters can never bridge to (open onto) the flag's edge.
 */
function drawFlagCut(
  canvas: Canvas,
  code: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  canvas.draw(flagSprite(code, w, h), x, y);
  const tw = measure(small, code);
  const th = 5;
  if (tw <= w - 2 && th <= h - 2) {
    drawText(
      canvas,
      small,
      code,
      x + Math.round((w - tw) / 2),
      y + Math.round((h - th) / 2),
      BLACK,
    );
  }
}

// Workshop layout (showcase-only): two 24×16 flags stacked fill the 32px height,
// so the day/time are dropped for now — that's the open question to iterate on.
const FLAG_W = 24;
const FLAG_H = 16;
const DWELL = 3.2; // seconds a card sits still (readable)
const SLIDE = 0.4; // seconds to slide to the next card

function drawCard(canvas: Canvas, m: Match, x: number): void {
  if (x + canvas.width <= 0 || x >= canvas.width) return; // fully offscreen
  const fx = x + Math.round((canvas.width - FLAG_W) / 2);
  drawFlagCut(canvas, m.home.team.code, fx, 0, FLAG_W, FLAG_H);
  drawFlagCut(canvas, m.away.team.code, fx, FLAG_H, FLAG_W, FLAG_H);
}

/** Render one frame of the schedule ticker. `t` is seconds since scene start. */
export function drawSchedule(canvas: Canvas, fx: Fixtures, t: number): void {
  canvas.clear(BLACK);
  const list = fx.list;
  if (list.length === 0) return;
  if (list.length === 1) {
    drawCard(canvas, list[0]!, 0);
    return;
  }

  // Paged motion: each card sits still for DWELL seconds (readable), then slides
  // quickly to the next. Far easier to read than a constant crawl.
  const period = DWELL + SLIDE;
  const cycle = list.length * period;
  const tt = ((t % cycle) + cycle) % cycle;
  const idx = Math.floor(tt / period);
  const phase = tt - idx * period;

  let offset = 0;
  if (phase > DWELL) {
    const k = (phase - DWELL) / SLIDE; // 0..1 through the slide
    const eased = k * k * (3 - 2 * k); // smoothstep
    offset = -Math.round(eased * canvas.width);
  }
  drawCard(canvas, list[idx]!, offset);
  if (offset !== 0) drawCard(canvas, list[(idx + 1) % list.length]!, offset + canvas.width);
}
