---
"@aubron/world-cup-scoreboard": minor
---

Goal sound effects: a spoken announcer call, cast to a Nest Hub.

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
