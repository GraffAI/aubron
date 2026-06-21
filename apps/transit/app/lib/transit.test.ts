import { describe, expect, it } from "vitest";

import { arrivalState, isOnTime, type StopArrival } from "./transit";

// A live, fresh fix sitting right at the platform by default; tests vary one axis.
const base: StopArrival = {
  tripId: "t",
  routeId: "r",
  shortName: "1 Line",
  mode: "light-rail",
  headsign: "Northgate",
  arrival: Date.now(),
  minutesAway: 0,
  deviation: 0,
  predicted: true,
  stopsAway: 0,
  distanceFromStop: 40,
  gpsAgeSec: 15,
  vehicleLon: -122.33,
  vehicleLat: 47.6,
};

describe("arrivalState", () => {
  it("reads ARRIVED only when a fresh fix is at the platform", () => {
    expect(arrivalState({ ...base, distanceFromStop: 40 }).state).toBe("arrived");
  });

  it("does NOT flip to ARRIVED when the train is far, even if the clock lapsed", () => {
    // The reported bug: next stop, prediction due/passed, but GPS still 1.5km out.
    expect(arrivalState({ ...base, distanceFromStop: 1500, minutesAway: 0 }).state).toBe(
      "arriving",
    );
    expect(arrivalState({ ...base, distanceFromStop: 1500, minutesAway: 1 })).toEqual({
      state: "due",
      minutes: 1,
    });
  });

  it("reads ARRIVING while the fix is closing on the platform", () => {
    expect(arrivalState({ ...base, distanceFromStop: 400 }).state).toBe("arriving");
  });

  it("won't trust a stale fix to declare arrival", () => {
    // Old ping near the stop → fall back to the clock, never claim ARRIVED.
    expect(
      arrivalState({ ...base, distanceFromStop: 30, gpsAgeSec: 300, minutesAway: 0 }).state,
    ).toBe("arriving");
  });

  it("counts minutes for a live train still a ways out", () => {
    expect(arrivalState({ ...base, distanceFromStop: 4000, minutesAway: 5 })).toEqual({
      state: "soon",
      minutes: 5,
    });
  });

  it("flags schedule-only arrivals distinctly and never as arrived", () => {
    expect(
      arrivalState({
        ...base,
        predicted: false,
        distanceFromStop: undefined,
        vehicleLon: undefined,
        vehicleLat: undefined,
        minutesAway: 9,
      }),
    ).toEqual({ state: "scheduled", minutes: 9 });
  });

  it("calls a one-minute, unconfirmed arrival due", () => {
    expect(
      arrivalState({ ...base, distanceFromStop: undefined, vehicleLon: undefined, minutesAway: 1 }),
    ).toEqual({ state: "due", minutes: 1 });
  });
});

describe("isOnTime", () => {
  it("treats sub-minute deviation as on time", () => {
    expect(isOnTime(45)).toBe(true);
    expect(isOnTime(-200)).toBe(false);
  });
});
