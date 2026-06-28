---
"@aubron/world-cup-scoreboard": minor
---

Goal sound effects: fire a webhook when a celebration starts on screen.

- New `--goalWebhook <url>` flag / `WC_GOAL_WEBHOOK` env: the daemon POSTs a JSON
  goal event (`team`, `teamName`, `home`/`away`, scores, `minute`) the moment a
  celebration begins — so the sound lands with the right match even when goals
  queue back-to-back. Fire-and-forget and time-boxed
  (`WC_GOAL_WEBHOOK_TIMEOUT_MS`); a missing speaker never disrupts the panel.
- Decoupled by design: the daemon owns no audio. Pair it with the included
  `examples/home-assistant.yaml` to cast a "GOAL!" chime to a Google Nest Hub
  (volume save/restore, optional TTS) — see README "Goal sound effects".
- New `onGoal` engine hook + exported `goalAnnouncement()` builder.
