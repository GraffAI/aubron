import { describe, expect, it } from "vitest";

import { arrivalState, framableByDirection, isOnTime, type StopArrival } from "./transit";

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

describe("framableByDirection", () => {
  const at = (over: Partial<StopArrival>): StopArrival => ({ ...base, ...over });

  it("keeps the soonest live train in each direction", () => {
    const north1 = at({ tripId: "n1", headsign: "Northgate", arrival: 100, vehicleLon: -122.3 });
    const north2 = at({ tripId: "n2", headsign: "Northgate", arrival: 300, vehicleLon: -122.2 });
    const south1 = at({ tripId: "s1", headsign: "Angle Lake", arrival: 200, vehicleLon: -122.4 });
    const picked = framableByDirection([north2, south1, north1]);
    // One per headsign (the soonest of each), sorted soonest-first.
    expect(picked.map((a) => a.tripId)).toEqual(["n1", "s1"]);
  });

  it("skips arrivals with no live position — they can't be framed", () => {
    const live = at({ tripId: "live", headsign: "Northgate", vehicleLon: -122.3, arrival: 200 });
    const ghost = at({
      tripId: "ghost",
      headsign: "Angle Lake",
      arrival: 100,
      vehicleLon: undefined,
      vehicleLat: undefined,
    });
    expect(framableByDirection([ghost, live]).map((a) => a.tripId)).toEqual(["live"]);
  });

  it("returns nothing when no arrival has a live fix", () => {
    expect(framableByDirection([at({ vehicleLon: undefined, vehicleLat: undefined })])).toEqual([]);
  });
});

describe("isOnTime", () => {
  it("treats sub-minute deviation as on time", () => {
    expect(isOnTime(45)).toBe(true);
    expect(isOnTime(-200)).toBe(false);
  });
});
