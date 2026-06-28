import { describe, expect, it } from "vitest";

import { leadChangeLine, resultLine } from "./commentary.js";
import type { GoalAnnouncement, MatchResult } from "./engine.js";

const goal: GoalAnnouncement = {
  competition: "WC",
  matchId: "TUNUSA",
  team: "TUN",
  teamName: "Tunisia",
  home: "TUN",
  away: "USA",
  homeName: "Tunisia",
  awayName: "USA",
  homeScore: 2,
  awayScore: 1,
  minute: 60,
  leadChange: true,
};

const leadLine = (over: Partial<GoalAnnouncement>): string => leadChangeLine({ ...goal, ...over });

const result: MatchResult = {
  competition: "WC",
  matchId: "TUNUSA",
  home: "TUN",
  away: "USA",
  homeName: "Tunisia",
  awayName: "USA",
  homeScore: 2,
  awayScore: 1,
};

const ftLine = (over: Partial<MatchResult>): string => resultLine({ ...result, ...over });

describe("leadChangeLine", () => {
  it("phrases the scoring team pulling ahead, naming the opponent", () => {
    expect(leadLine({})).toBe("Tunisia score, pulling ahead two to one against USA!");
  });

  it("reads the away team taking the lead", () => {
    expect(leadLine({ team: "USA", teamName: "USA", homeScore: 1, awayScore: 2 })).toBe(
      "USA score, pulling ahead two to one against Tunisia!",
    );
  });

  it("phrases an equalizer as levelling it", () => {
    // USA peg it back to 2–2.
    expect(leadLine({ team: "USA", teamName: "USA", homeScore: 2, awayScore: 2 })).toBe(
      "USA score, levelling it at two all against Tunisia!",
    );
  });
});

describe("resultLine", () => {
  it("names the winner, loser and scoreline", () => {
    expect(ftLine({})).toBe("Tunisia beat USA two to one!");
  });

  it("reads an away win", () => {
    expect(ftLine({ homeScore: 0, awayScore: 3 })).toBe("USA beat Tunisia three to nil!");
  });

  it("phrases a score draw as 'all'", () => {
    expect(ftLine({ homeScore: 1, awayScore: 1 })).toBe("Tunisia and USA draw one all!");
  });

  it("phrases a goalless draw", () => {
    expect(ftLine({ homeScore: 0, awayScore: 0 })).toBe(
      "Tunisia and USA play out a goalless draw!",
    );
  });
});
