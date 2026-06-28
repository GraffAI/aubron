/**
 * Turn a goal into a line of commentary for the announcer voice, e.g.
 *   "Argentina has SCORED, putting them up two to nil in the first half!"
 *
 * Pure and deterministic so it can be unit-tested; the ElevenLabs call lives
 * elsewhere. Numbers are spelled out (with British "nil") because they read more
 * naturally through TTS than digits.
 */
import type { GoalAnnouncement } from "./engine.js";

const WORDS = [
  "nil",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

/** Spell a small score (0 → "nil"), falling back to digits past the table. */
function word(n: number): string {
  return WORDS[n] ?? String(n);
}

/** Where in the match the goal landed, as a trailing clause (or ""). */
function periodPhrase(minute: number | null): string {
  if (minute == null) return "";
  if (minute <= 45) return " in the first half";
  if (minute <= 90) return " in the second half";
  return " in stoppage time";
}

/** The scoreline clause from the scoring team's perspective. */
function statePhrase(scoring: number, other: number): string {
  if (scoring > other) return `putting them up ${word(scoring)} to ${word(other)}`;
  if (scoring === other) return `levelling it at ${word(scoring)} all`;
  return `now ${word(other)} to ${word(scoring)} down`;
}

/** Build the announcer line for a freshly-scored goal. */
export function announcementLine(a: GoalAnnouncement): string {
  const scoredHome = a.team === a.home;
  const scoring = scoredHome ? a.homeScore : a.awayScore;
  const other = scoredHome ? a.awayScore : a.homeScore;
  return `${a.teamName} has SCORED, ${statePhrase(scoring, other)}${periodPhrase(a.minute)}!`;
}
