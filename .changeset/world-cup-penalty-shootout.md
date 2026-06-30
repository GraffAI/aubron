---
"@aubron/world-cup-scoreboard": minor
---

world-cup-scoreboard: penalty-shootout showdown on the sign. The api-football
provider now reads `score.penalty` and the fixtures/events feed to decode each
spot kick, and the scoreboard renders the traditional five-dot row per team
(green = scored, red = missed) with the running PK tally in the status strip and
a gold underline under the winner — instead of freezing on the impossible-looking
after-extra-time draw. The full-time announcer line now names the shootout winner
("… beat … on penalties!") rather than calling an eliminated team a draw.
