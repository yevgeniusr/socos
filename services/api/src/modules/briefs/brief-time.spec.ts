import {
  assertTimeZone,
  dateKeyToUtcDate,
  daysFromLocalDate,
  localDateKey,
} from "./brief-time.js";

describe("brief time helpers", () => {
  describe("localDateKey", () => {
    it("resolves the next local day in Asia/Dubai without changing the process timezone", () => {
      expect(localDateKey(new Date("2026-07-16T20:30:00Z"), "Asia/Dubai")).toBe(
        "2026-07-17"
      );
    });

    it("resolves the previous local day in Pacific/Honolulu", () => {
      expect(
        localDateKey(new Date("2026-01-01T00:30:00Z"), "Pacific/Honolulu")
      ).toBe("2025-12-31");
    });
  });

  describe("assertTimeZone", () => {
    it("rejects invalid IANA timezone names", () => {
      expect(() => assertTimeZone("Mars/Olympus")).toThrow(
        "Invalid IANA time zone"
      );
    });
  });

  describe("dateKeyToUtcDate", () => {
    it("uses UTC midnight only as the PostgreSQL DATE carrier", () => {
      expect(dateKeyToUtcDate("2026-07-17").toISOString()).toBe(
        "2026-07-17T00:00:00.000Z"
      );
    });
  });

  describe("daysFromLocalDate", () => {
    it("rolls a December date forward to the next January occurrence", () => {
      expect(
        daysFromLocalDate(new Date("2026-12-31T12:00:00Z"), "UTC", 1, 1)
      ).toEqual({ dateKey: "2027-01-01", daysAway: 1 });
    });

    it("rolls February 29 forward to the next leap year", () => {
      expect(
        daysFromLocalDate(new Date("2026-03-01T12:00:00Z"), "UTC", 2, 29)
      ).toEqual({ dateKey: "2028-02-29", daysAway: 730 });
    });

    it("returns zero for a same-day occurrence", () => {
      expect(
        daysFromLocalDate(new Date("2026-07-16T20:30:00Z"), "Asia/Dubai", 7, 17)
      ).toEqual({ dateKey: "2026-07-17", daysAway: 0 });
    });

    it("keeps the fourteenth day inside an inclusive horizon", () => {
      expect(
        daysFromLocalDate(new Date("2026-07-16T12:00:00Z"), "UTC", 7, 30)
      ).toEqual({ dateKey: "2026-07-30", daysAway: 14 });
    });
  });
});
