---
"@aubron/world-cup-scoreboard": minor
---

Refine the goal sound: horn for every goal, announcer voice only for the moments
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
