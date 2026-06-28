---
"@aubron/world-cup-scoreboard": minor
---

Initial release of @aubron/world-cup-scoreboard — drive a 30x32 WLED LED matrix
as a live FIFA World Cup scoreboard. Rotates through every in-play match with
real pixel-art flags (vector fallback), a ticking match clock with stoppage
time, and an animated GOAL celebration; idles on the day's upcoming fixtures.
Frames are gamma-corrected and streamed to WLED over DDP. Ships data providers
for api-football and football-data.org plus a keyless mock, `preview` / `flags`
PNG tooling, a `calibrate` command for mapping converted Govee-curtain wiring,
and launchd/flag installers under `deploy/`.
