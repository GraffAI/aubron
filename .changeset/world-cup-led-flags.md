---
"@aubron/world-cup-scoreboard": minor
---

Replace the shaded icon-pack flags with committed sprites generated from the
official Wikimedia Commons SVGs. A new `pnpm gen:flags` pipeline rasterises
each public-domain flag SVG, recovers its flat palette, and downscales with a
salience-weighted per-cell vote so emblems (Canada's maple leaf, crescents,
stars) survive at LED sizes with zero shading or anti-aliasing mush. Sprites
now ship at all four native scene sizes — 12×8, 18×12 (new; the scoreboard no
longer nearest-neighbour squashes 24×16), 24×16 and 48×32 — are committed to
the repo, published with the package, and load correctly in dev (tsx/vitest)
as well as from the bundled dist. The ReffPixels install script and its
outline-bleed loader are gone.
