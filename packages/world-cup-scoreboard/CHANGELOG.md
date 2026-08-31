# @aubron/world-cup-scoreboard

## 0.1.0

### Minor Changes

- [#42](https://github.com/GraffAI/aubron/pull/42) [`1d00253`](https://github.com/GraffAI/aubron/commit/1d00253ef58dcc8f4e22c3b96ccef661ce7f158f) Thanks [@Aubron](https://github.com/Aubron)! - Refine the goal sound: horn for every goal, announcer voice only for the moments
  that matter.

  - **Goals are now just the horn** — no spoken "GOAL!" line. The on-screen
    celebration holds longer (`GOAL_DURATION` 4.2s → 7s) so it's still up once the
    Chromecast finishes connecting and the horn lands.
  - **The announcer voice is reserved for two triggers**, narrated without "goal!"
    and naming both teams (`commentary.ts`):
    - **lead changes** — a goal that takes, overtakes or levels the score, e.g.
      "Tunisia score, pulling ahead two to one against the United States!";
    - **full-time results** — wins and draws, e.g. "Tunisia beat the United States
      two to one!".
  - New engine detectors `leadChanged()` / `detectFinish()` and an `onMatchEnd`
    hook + `matchResult()` builder; `GoalAnnouncement` gains both team names and a
    `leadChange` flag. A lead-changing goal casts horn ++ speech; a result casts
    the spoken line alone.
  - Best-effort as before: if TTS fails a goal still plays the horn, and the
    webhook path now carries both team names, `leadChange`, and the `line` for the
    narrated events.

- [#48](https://github.com/GraffAI/aubron/pull/48) [`8416830`](https://github.com/GraffAI/aubron/commit/8416830bbd48bff72db3a0093f07cbd29c8edae9) Thanks [@Aubron](https://github.com/Aubron)! - Replace the shaded icon-pack flags with committed sprites generated from the
  official Wikimedia Commons SVGs. A new `pnpm gen:flags` pipeline rasterises
  each public-domain flag SVG, recovers its flat palette, and downscales with a
  salience-weighted per-cell vote so emblems (Canada's maple leaf, crescents,
  stars) survive at LED sizes with zero shading or anti-aliasing mush. Sprites
  now ship at all four native scene sizes — 12×8, 18×12 (new; the scoreboard no
  longer nearest-neighbour squashes 24×16), 24×16 and 48×32 — are committed to
  the repo, published with the package, and load correctly in dev (tsx/vitest)
  as well as from the bundled dist. The ReffPixels install script and its
  outline-bleed loader are gone.

- [#47](https://github.com/GraffAI/aubron/pull/47) [`73159c0`](https://github.com/GraffAI/aubron/commit/73159c0bdae20cbafed927583649e72aebb992d2) Thanks [@Aubron](https://github.com/Aubron)! - world-cup-scoreboard: penalty-shootout showdown on the sign. The api-football
  provider now reads `score.penalty` and the fixtures/events feed to decode each
  spot kick, and the scoreboard renders the traditional five-dot row per team
  (green = scored, red = missed) with the running PK tally in the status strip and
  a gold underline under the winner — instead of freezing on the impossible-looking
  after-extra-time draw. The full-time announcer line now names the shootout winner
  ("… beat … on penalties!") rather than calling an eliminated team a draw.

- [#41](https://github.com/GraffAI/aubron/pull/41) [`03a8f41`](https://github.com/GraffAI/aubron/commit/03a8f4136e23d8b223ca686eb4353787f3b29f7a) Thanks [@Aubron](https://github.com/Aubron)! - Goal sound effects: a spoken announcer call, cast to a Nest Hub.

  When a celebration starts on screen the daemon can narrate the goal in a
  football-commentator voice, splice it onto a goal horn, and cast the result to a
  Chromecast — fired at celebration-start so the audio lands with the right match
  even when goals queue back-to-back.

  - **Commentary** built from match context, e.g. "Argentina has SCORED, putting
    them up two to nil in the first half!" (`commentary.ts`).
  - **ElevenLabs TTS** (`elevenlabs.ts`) — default voice "British Football
    Announcer", default model Eleven v3; resolves a voice by name. Enabled by
    `WC_GOAL_HORN` plus `WC_ELEVENLABS_API_KEY`.
  - **Pure-Node MP3 concat** (`mp3.ts`) — strips ID3 and joins frames, no ffmpeg;
    speech is requested at 44.1 kHz/128 kbps to match the horn.
  - **Casting** — the daemon serves each clip over HTTP (`audioserver.ts`, Range
    support) and drives Home Assistant's REST API directly (`hass.ts`):
    `WC_HASS_URL` / `WC_HASS_TOKEN` / `WC_HASS_ENTITY`, optional volume
    duck/restore via `WC_HASS_VOLUME`. A `WC_GOAL_WEBHOOK` path remains for letting
    HA own the sound (now also carries `line` + `audioUrl`).
  - Best-effort throughout: TTS failure falls back to horn-only, errors are
    logged and swallowed, so a speaker hiccup never disturbs the panel.
  - New `onGoal` engine hook + exported `goalAnnouncement()` builder.

- [#39](https://github.com/GraffAI/aubron/pull/39) [`284dbf8`](https://github.com/GraffAI/aubron/commit/284dbf8a7c29f41c544348b925bee487d0b5a251) Thanks [@Aubron](https://github.com/Aubron)! - Initial release of @aubron/world-cup-scoreboard — drive a WLED LED matrix as a
  live FIFA World Cup scoreboard, streamed over DDP.

- [#40](https://github.com/GraffAI/aubron/pull/40) [`40a7a18`](https://github.com/GraffAI/aubron/commit/40a7a18dd5aefb829f2b2e8454b96f159406ce17) Thanks [@Aubron](https://github.com/Aubron)! - Live build-out, verified on a real 30x32 panel during the tournament:

  - Rotate through every in-play match (live games preempt the pre-match countdown
    and post-FT grace window); a goal in any match queues a celebration so
    simultaneous goals all play.
  - Real pixel-art flags (native 12x8 / 24x16, vector fallback), full-bleed and
    gamma-corrected so colours don't wash out on LEDs; all 48 qualifiers covered.
  - Ticking MM:SS match clock with stoppage time (45+2); GROUP-style idle cards
    alternating with a clock.
  - Widened M/N/W glyphs for legibility; `showcase` / `flags` tooling and `deploy/`
    launchd + flag installers.

### Patch Changes

- [#52](https://github.com/GraffAI/aubron/pull/52) [`a9f423f`](https://github.com/GraffAI/aubron/commit/a9f423f559ae62fc1370a2745e990e293321c4c5) Thanks [@Aubron](https://github.com/Aubron)! - Switch the default announcer voice from "British Football Announcer" to "Ethar".
  Override as before with `--voice` or `WC_ELEVENLABS_VOICE` (a name or id).
