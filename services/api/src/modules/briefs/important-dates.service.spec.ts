import { PrismaService } from "../prisma/prisma.service.js";
import { getGregorianDateForCelebration } from "../celebrations/celebrations.service.js";
import { ImportantDatesService } from "./important-dates.service.js";

const ownerId = "owner-synthetic";
const now = new Date("2026-12-20T12:00:00Z");

function contact(overrides: Record<string, unknown>) {
  return {
    id: "contact-default",
    ownerId,
    isDemo: false,
    firstName: "Synthetic",
    lastName: "Contact",
    birthday: null,
    anniversary: null,
    ...overrides,
  };
}

describe("ImportantDatesService", () => {
  it("collects, deduplicates, and deterministically sorts an inclusive horizon", async () => {
    const prisma = {
      contact: {
        findMany: jest.fn().mockResolvedValue([
          contact({
            id: "contact-birthday",
            firstName: "Birthday",
            birthday: new Date("1990-12-22T00:00:00Z"),
          }),
          contact({
            id: "contact-anniversary",
            firstName: "Anniversary",
            anniversary: new Date("2019-12-20T00:00:00Z"),
          }),
          contact({
            id: "contact-horizon",
            firstName: "Horizon",
            birthday: new Date("1991-01-03T00:00:00Z"),
          }),
          contact({
            id: "contact-demo",
            isDemo: true,
            firstName: "Excluded Demo",
            birthday: new Date("1992-12-20T00:00:00Z"),
          }),
          contact({
            id: "contact-foreign",
            ownerId: "owner-foreign",
            firstName: "Excluded Foreign",
            birthday: new Date("1993-12-20T00:00:00Z"),
          }),
        ]),
      },
      contactCelebration: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "contact-celebration-active",
            ownerId,
            status: "active",
            shouldRemind: true,
            customDate: null,
            contact: contact({
              id: "contact-celebration",
              firstName: "Celebration",
            }),
            celebration: {
              id: "celebration-winter",
              name: "Winter Gathering",
              date: "12-21",
              fullDate: null,
              calendarType: "gregorian",
            },
          },
          {
            id: "contact-celebration-ignored",
            ownerId,
            status: "ignored",
            shouldRemind: true,
            customDate: null,
            contact: contact({ id: "contact-ignored" }),
            celebration: {
              id: "celebration-ignored",
              name: "Ignored Occasion",
              date: "12-20",
              fullDate: null,
              calendarType: "gregorian",
            },
          },
        ]),
      },
      reminder: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "reminder-duplicate-birthday",
            ownerId,
            status: "pending",
            type: "birthday",
            title: "Birthday reminder",
            description: null,
            scheduledAt: new Date("2026-12-22T09:00:00Z"),
            contact: contact({
              id: "contact-birthday",
              firstName: "Birthday",
            }),
          },
          {
            id: "reminder-generated-celebration",
            ownerId,
            status: "pending",
            type: "birthday",
            title: "Celebration - Winter Gathering",
            description: null,
            scheduledAt: new Date("2026-12-21T09:00:00Z"),
            contact: contact({
              id: "contact-celebration",
              firstName: "Celebration",
            }),
          },
          {
            id: "reminder-z",
            ownerId,
            status: "pending",
            type: "followup",
            title: "Follow up later",
            description: "A pending follow-up",
            scheduledAt: new Date("2026-12-21T09:00:00Z"),
            contact: contact({ id: "contact-reminder-z", firstName: "Later" }),
          },
          {
            id: "reminder-a",
            ownerId,
            status: "pending",
            type: "custom",
            title: "Call first",
            description: null,
            scheduledAt: new Date("2026-12-21T10:00:00Z"),
            contact: contact({ id: "contact-reminder-a", firstName: "First" }),
          },
          {
            id: "reminder-completed",
            ownerId,
            status: "completed",
            type: "followup",
            title: "Completed",
            description: null,
            scheduledAt: new Date("2026-12-21T10:00:00Z"),
            contact: contact({ id: "contact-completed" }),
          },
          {
            id: "reminder-overdue",
            ownerId,
            status: "pending",
            type: "followup",
            title: "Overdue",
            description: null,
            scheduledAt: new Date("2026-12-19T10:00:00Z"),
            contact: contact({ id: "contact-overdue" }),
          },
          {
            id: "reminder-outside-horizon",
            ownerId,
            status: "pending",
            type: "followup",
            title: "Too far away",
            description: null,
            scheduledAt: new Date("2027-01-04T10:00:00Z"),
            contact: contact({ id: "contact-outside" }),
          },
        ]),
      },
    };
    const service = new ImportantDatesService(
      prisma as unknown as PrismaService
    );

    const result = await service.collect(ownerId, now, "UTC", 14);

    expect(
      result.map(({ sourceType, sourceId, dateKey, daysAway }) => ({
        sourceType,
        sourceId,
        dateKey,
        daysAway,
      }))
    ).toEqual([
      {
        sourceType: "anniversary",
        sourceId: "contact-anniversary",
        dateKey: "2026-12-20",
        daysAway: 0,
      },
      {
        sourceType: "celebration",
        sourceId: "contact-celebration-active",
        dateKey: "2026-12-21",
        daysAway: 1,
      },
      {
        sourceType: "reminder",
        sourceId: "reminder-a",
        dateKey: "2026-12-21",
        daysAway: 1,
      },
      {
        sourceType: "reminder",
        sourceId: "reminder-z",
        dateKey: "2026-12-21",
        daysAway: 1,
      },
      {
        sourceType: "birthday",
        sourceId: "contact-birthday",
        dateKey: "2026-12-22",
        daysAway: 2,
      },
      {
        sourceType: "birthday",
        sourceId: "contact-horizon",
        dateKey: "2027-01-03",
        daysAway: 14,
      },
    ]);
    expect(result.find((item) => item.sourceId === "contact-birthday")).toEqual(
      expect.objectContaining({
        contactId: "contact-birthday",
        contactName: "Birthday Contact",
        title: "Birthday Contact's birthday",
      })
    );

    expect(prisma.contact.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId, isDemo: false }),
      })
    );
    expect(prisma.contactCelebration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerId,
          status: "active",
          shouldRemind: true,
          contact: { ownerId, isDemo: false },
        }),
      })
    );
    expect(prisma.reminder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerId,
          status: "pending",
          contact: { ownerId, isDemo: false },
        }),
      })
    );
  });

  it("does not expose contact content through logs or timezone errors", async () => {
    const prisma = {
      contact: { findMany: jest.fn() },
      contactCelebration: { findMany: jest.fn() },
      reminder: { findMany: jest.fn() },
    };
    const log = jest.spyOn(console, "log").mockImplementation();
    const warn = jest.spyOn(console, "warn").mockImplementation();
    const error = jest.spyOn(console, "error").mockImplementation();
    const service = new ImportantDatesService(
      prisma as unknown as PrismaService
    );

    await expect(
      service.collect(ownerId, now, "Mars/Olympus", 14)
    ).rejects.toThrow("Invalid IANA time zone");

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(prisma.contact.findMany).not.toHaveBeenCalled();
    log.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });

  it("deduplicates a UTC date-carrier reminder in a negative-offset timezone", async () => {
    const attached = {
      id: "contact-celebration-honolulu",
      ownerId,
      status: "active",
      shouldRemind: true,
      customDate: null,
      contact: contact({
        id: "contact-honolulu",
        firstName: "Honolulu",
      }),
      celebration: {
        id: "celebration-honolulu",
        name: "Island Day",
        date: "12-21",
        fullDate: null,
        calendarType: "gregorian",
      },
    };
    const prisma = {
      contact: { findMany: jest.fn().mockResolvedValue([]) },
      contactCelebration: { findMany: jest.fn().mockResolvedValue([attached]) },
      reminder: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "reminder-honolulu",
            ownerId,
            status: "pending",
            type: "birthday",
            title: "Honolulu - Island Day",
            description: null,
            scheduledAt: new Date("2026-12-21T00:00:00Z"),
            contact: attached.contact,
          },
        ]),
      },
    };
    const service = new ImportantDatesService(
      prisma as unknown as PrismaService
    );

    const result = await service.collect(
      ownerId,
      new Date("2026-12-20T12:00:00Z"),
      "Pacific/Honolulu",
      14
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sourceType: "celebration",
      sourceId: "contact-celebration-honolulu",
      dateKey: "2026-12-21",
      daysAway: 1,
    });
  });
});

describe("getGregorianDateForCelebration", () => {
  it.each(["lunar", "chinese"])(
    "converts %s recurrence through the shared lunar helper",
    (calendarType) => {
      expect(
        getGregorianDateForCelebration(
          { date: "01-01", fullDate: null, calendarType },
          2026
        )?.toISOString()
      ).toBe("2026-02-17T00:00:00.000Z");
    }
  );

  it("returns Gregorian recurrence at UTC midnight", () => {
    expect(
      getGregorianDateForCelebration(
        { date: "07-16", fullDate: null, calendarType: "gregorian" },
        2026
      )?.toISOString()
    ).toBe("2026-07-16T00:00:00.000Z");
  });

  it.each([
    ["gregorian", "02-30"],
    ["gregorian", "1-01"],
    ["lunar", "02-31"],
    ["lunar", "13-01"],
    ["chinese", "00-01"],
    ["chinese", "01-31"],
  ])("rejects invalid %s MM-DD value %s", (calendarType, date) => {
    expect(
      getGregorianDateForCelebration(
        { date, fullDate: null, calendarType },
        2026
      )
    ).toBeNull();
  });

  it("rejects an invalid MM-DD value instead of bypassing it for fullDate", () => {
    expect(
      getGregorianDateForCelebration(
        {
          date: "not-a-date",
          fullDate: new Date("2026-07-16T00:00:00Z"),
          calendarType: "gregorian",
        },
        2026
      )
    ).toBeNull();
  });

  it("rejects an invalid fullDate value", () => {
    expect(
      getGregorianDateForCelebration(
        {
          date: "07-16",
          fullDate: new Date("invalid"),
          calendarType: "gregorian",
        },
        2026
      )
    ).toBeNull();
  });

  it("rejects unsupported calendar types", () => {
    expect(
      getGregorianDateForCelebration(
        { date: "07-16", fullDate: null, calendarType: "martian" },
        2026
      )
    ).toBeNull();
  });
});
