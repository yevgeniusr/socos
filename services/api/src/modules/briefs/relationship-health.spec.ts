import { assessRelationship, rankRelationship } from "./relationship-health.js";

const now = new Date("2026-07-16T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

describe("relationship health", () => {
  it.each([
    [30, 30],
    [90, 90],
    [180, 180],
  ])("scores one full %i-day cadence at 50", (cadence, elapsedDays) => {
    expect(
      assessRelationship({
        now,
        lastContactedAt: daysAgo(elapsedDays),
        preferredCadenceDays: cadence,
      }).score
    ).toBe(50);
  });

  it("scores day zero at 100 and two full cadences at zero", () => {
    expect(
      assessRelationship({
        now,
        lastContactedAt: now,
        preferredCadenceDays: 30,
      })
    ).toMatchObject({ score: 100, daysSinceContact: 0, daysOverdue: 0 });
    expect(
      assessRelationship({
        now,
        lastContactedAt: daysAgo(60),
        preferredCadenceDays: 30,
      })
    ).toMatchObject({ score: 0, daysSinceContact: 60, daysOverdue: 30 });
  });

  it("assigns never-contacted relationships a stable baseline", () => {
    expect(
      assessRelationship({
        now,
        lastContactedAt: null,
        preferredCadenceDays: 90,
      })
    ).toEqual({
      score: 35,
      band: "needs-attention",
      daysSinceContact: null,
      daysOverdue: 0,
      reasonCode: "never_contacted",
    });
  });

  it("clamps a future last-contact timestamp to zero elapsed days", () => {
    expect(
      assessRelationship({
        now,
        lastContactedAt: new Date("2026-07-20T12:00:00Z"),
        preferredCadenceDays: 30,
      })
    ).toMatchObject({ score: 100, daysSinceContact: 0, daysOverdue: 0 });
  });

  it("rejects an invalid cadence", () => {
    expect(() =>
      assessRelationship({
        now,
        lastContactedAt: now,
        preferredCadenceDays: 0,
      })
    ).toThrow("preferredCadenceDays must be a positive integer");
  });

  it("calculates urgency from health and importance", () => {
    expect(
      rankRelationship({
        healthScore: 50,
        importance: 1,
      })
    ).toBe(33);
    expect(
      rankRelationship({
        healthScore: 50,
        importance: 5,
      })
    ).toBe(65);
  });

  it.each([
    [7, 20],
    [14, 10],
    [15, 0],
  ])("applies the date boost at %i days", (daysUntilImportantDate, boost) => {
    expect(
      rankRelationship({
        healthScore: 100,
        importance: 1,
        daysUntilImportantDate,
      })
    ).toBe(8 + boost);
  });

  it("adds a pending commitment boost and clamps urgency to 100", () => {
    expect(
      rankRelationship({
        healthScore: 0,
        importance: 5,
        daysUntilImportantDate: 2,
        pendingTaskCount: 1,
      })
    ).toBe(100);
  });

  it("rounds health and urgency to integers", () => {
    expect(
      assessRelationship({
        now,
        lastContactedAt: daysAgo(1),
        preferredCadenceDays: 30,
      }).score
    ).toBe(98);
    expect(rankRelationship({ healthScore: 99, importance: 1 })).toBe(9);
  });
});
