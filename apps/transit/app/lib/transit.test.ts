import { describe, expect, it } from "vitest";

import { arrivalState, isOnTime, type StopArrival } from "./transit";

const base: StopArrival = {
  tripId: "t",
  routeId: "r",
  shortName: "1 Line",
  mode: "light-rail",
  headsign: "Northgate",
  arrival: Date.now(),
  minutesAway: 5,
  deviation: 0,
  predicted: true,
  stopsAway: 3,
};

describe("arrivalState", () => {
  it("reads ARRIVED when the vehicle is at the stop and due", () => {
    expect(arrivalState({ ...base, stopsAway: 0, minutesAway: 0 }).state).toBe("arrived");
  });

  it("reads ARRIVING when due but still a stop out", () => {
    expect(arrivalState({ ...base, stopsAway: 1, minutesAway: 0 }).state).toBe("arriving");
  });

  it("counts minutes for a live future arrival", () => {
    expect(arrivalState({ ...base, minutesAway: 5 })).toEqual({ state: "soon", minutes: 5 });
  });

  it("flags schedule-only arrivals distinctly", () => {
    expect(arrivalState({ ...base, predicted: false, minutesAway: 9 })).toEqual({
      state: "scheduled",
      minutes: 9,
    });
  });

  it("calls a one-minute arrival due", () => {
    expect(arrivalState({ ...base, minutesAway: 1 })).toEqual({ state: "due", minutes: 1 });
  });
});

describe("isOnTime", () => {
  it("treats sub-minute deviation as on time", () => {
    expect(isOnTime(45)).toBe(true);
    expect(isOnTime(-200)).toBe(false);
  });
});
