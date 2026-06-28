/**
 * Turn match events into announcer lines for the ElevenLabs voice. Two triggers,
 * deliberately *not* every goal:
 *
 *   - a **lead change** (the team in front changes — taken, overtaken or pegged
 *     back to level): "Tunisia scores, pulling ahead two to one against the
 *     United States!"
 *   - a **result** at full time, win or draw: "Tunisia beat the United States
 *     two to one!"
 *
 * No "GOAL!" here — the horn already carries that. Each line names both teams and
 * the scoreline. Pure and deterministic so it can be unit-tested; the ElevenLabs
 * call lives elsewhere. Numbers are spelled out (with British "nil") because they
 * read more naturally through TTS than digits.
 */
import type { GoalAnnouncement, MatchResult } from "./engine.js";

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

/**
 * The line for a goal that changed who's leading. From the scoring team's view:
 * either they've gone ahead/overtaken, or they've levelled it.
 */
export function leadChangeLine(a: GoalAnnouncement): string {
  const scoredHome = a.team === a.home;
  const scoring = scoredHome ? a.homeScore : a.awayScore;
  const other = scoredHome ? a.awayScore : a.homeScore;
  const opponent = scoredHome ? a.awayName : a.homeName;
  if (scoring > other) {
    return `${a.teamName} score, pulling ahead ${word(scoring)} to ${word(other)} against ${opponent}!`;
  }
  return `${a.teamName} score, levelling it at ${word(scoring)} all against ${opponent}!`;
}

/** The full-time result line — a win or a draw, naming both teams. */
export function resultLine(r: MatchResult): string {
  if (r.homeScore === r.awayScore) {
    if (r.homeScore === 0) return `${r.homeName} and ${r.awayName} play out a goalless draw!`;
    return `${r.homeName} and ${r.awayName} draw ${word(r.homeScore)} all!`;
  }
  const homeWon = r.homeScore > r.awayScore;
  const winner = homeWon ? r.homeName : r.awayName;
  const loser = homeWon ? r.awayName : r.homeName;
  const w = homeWon ? r.homeScore : r.awayScore;
  const l = homeWon ? r.awayScore : r.homeScore;
  return `${winner} beat ${loser} ${word(w)} to ${word(l)}!`;
}
