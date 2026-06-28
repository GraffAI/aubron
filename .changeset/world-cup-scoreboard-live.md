---
"@aubron/world-cup-scoreboard": minor
---

Live build-out, verified on a real 30x32 panel during the tournament:

- Rotate through every in-play match (live games preempt the pre-match countdown
  and post-FT grace window); a goal in any match queues a celebration so
  simultaneous goals all play.
- Real pixel-art flags (native 12x8 / 24x16, vector fallback), full-bleed and
  gamma-corrected so colours don't wash out on LEDs; all 48 qualifiers covered.
- Ticking MM:SS match clock with stoppage time (45+2); GROUP-style idle cards
  alternating with a clock.
- Widened M/N/W glyphs for legibility; `showcase` / `flags` tooling and `deploy/`
  launchd + flag installers.
