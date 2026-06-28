import { describe, expect, it } from "vitest";

import { announcementLine } from "./commentary.js";
import type { GoalAnnouncement } from "./engine.js";

const base: GoalAnnouncement = {
  competition: "WC",
  matchId: "ARGFRA",
  team: "ARG",
  teamName: "Argentina",
  home: "ARG",
  away: "FRA",
  homeScore: 2,
  awayScore: 0,
  minute: 30,
};

const line = (over: Partial<GoalAnnouncement>): string => announcementLine({ ...base, ...over });

describe("announcementLine", () => {
  it("phrases a lead from the scoring team's perspective, with nil", () => {
    expect(line({})).toBe("Argentina has SCORED, putting them up two to nil in the first half!");
  });

  it("phrases a level score as 'all'", () => {
    expect(line({ team: "FRA", teamName: "France", homeScore: 2, awayScore: 2, minute: 70 })).toBe(
      "France has SCORED, levelling it at two all in the second half!",
    );
  });

  it("phrases the scoring team still trailing", () => {
    // ARG pull one back to 1–2.
    expect(line({ homeScore: 1, awayScore: 2, minute: 80 })).toBe(
      "Argentina has SCORED, now two to one down in the second half!",
    );
  });

  it("reads the away team's score correctly", () => {
    expect(line({ team: "FRA", teamName: "France", homeScore: 1, awayScore: 2, minute: 92 })).toBe(
      "France has SCORED, putting them up two to one in stoppage time!",
    );
  });

  it("omits the period when the minute is unknown", () => {
    expect(line({ minute: null })).toBe("Argentina has SCORED, putting them up two to nil!");
  });
});
