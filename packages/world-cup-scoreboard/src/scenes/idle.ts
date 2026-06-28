/**
 * Idle scene shown when no World Cup match is live: a big clock with a slowly
 * colour-cycling "WORLD CUP" wordmark. The engine can also choose to send
 * nothing while idle (letting WLED fall back to its own effects) — this scene is
 * for when you'd rather the panel always show something on-brand.
 */
import type { Canvas, RGB } from "../canvas.js";
import { hex, mix } from "../canvas.js";
import { bigDigits, drawText, small } from "../font.js";

const BG: RGB = [0, 0, 0];
const INK: RGB = hex("#E8EDF7");

function hhmm(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** `t` (seconds) drives the colour cycle and the blinking clock colon. */
export function drawIdle(canvas: Canvas, now: Date, t = 0): void {
  canvas.clear(BG);

  // Colour-cycling top wordmark.
  const phase = (Math.sin(t * 0.6) + 1) / 2;
  const accent = mix(hex("#1E88E5"), hex("#FFB020"), phase);
  drawText(canvas, small, "WORLD", Math.round(canvas.width / 2), 2, accent, { center: true });
  drawText(canvas, small, "CUP", Math.round(canvas.width / 2), 8, accent, { center: true });

  // Clock HH:MM with a blinking colon, centered.
  const time = hhmm(now);
  const blink = Math.floor(t) % 2 === 0;
  // Width: each digit is cell+1px; the colon is 3px wide (1px pad each side of
  // the 2px dots) so HH:MM fits 30px exactly without clipping the last digit.
  const digitW = bigDigits.width + 1;
  const width = [...time].reduce((acc, ch) => acc + (ch === ":" ? 3 : digitW), 0) - 1;
  const y = Math.round(canvas.height * 0.5) - 2;
  let cx = Math.round((canvas.width - width) / 2);
  for (const ch of time) {
    if (ch === ":") {
      if (blink) {
        canvas.fillRect(cx, y + 3, 2, 2, INK);
        canvas.fillRect(cx, y + 6, 2, 2, INK);
      }
      cx += 3;
    } else {
      drawText(canvas, bigDigits, ch, cx, y, INK);
      cx += bigDigits.width + 1;
    }
  }

  drawText(canvas, small, "2026", Math.round(canvas.width / 2), canvas.height - 6, accent, {
    center: true,
  });
}
