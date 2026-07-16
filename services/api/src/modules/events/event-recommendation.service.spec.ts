import { EventRecommendationService } from "./event-recommendation.service.js";

const NOW = new Date("2026-07-16T10:00:00.000Z");
const ENVELOPE = {
  ciphertext: Buffer.from("cipher"),
  iv: Buffer.alloc(12),
  tag: Buffer.alloc(16),
  keyVersion: 1,
};

type HarnessOptions = {
  fullSyncRequired?: boolean;
  calendarEvents?: unknown[];
  events?: unknown[];
  contacts?: unknown[];
  feedback?: unknown[];
  preference?: unknown;
};

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: "event-1",
    ownerId: "owner-1",
    title: "AI community dinner",
    startAt: new Date("2026-07-16T18:00:00.000Z"),
    endAt: new Date("2026-07-16T20:00:00.000Z"),
    city: "Dubai",
    countryCode: "AE",
    latitude: null,
    longitude: null,
    category: "community",
    tags: ["AI", "Community"],
    providerEventIdCiphertext: Buffer.from("provider-cipher"),
    providerEventIdIv: Buffer.alloc(12),
    providerEventIdTag: Buffer.alloc(16),
    providerEventIdKeyVersion: 1,
    source: { id: "source-1", ownerId: "owner-1", status: "active", socialWeight: 5 },
    ...overrides,
  };
}

function calendarEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "calendar-1",
    ownerId: "owner-1",
    status: "confirmed",
    startAt: new Date("2026-07-16T17:45:00.000Z"),
    endAt: new Date("2026-07-16T18:30:00.000Z"),
    transparency: "opaque",
    detailsCiphertext: ENVELOPE.ciphertext,
    detailsIv: ENVELOPE.iv,
    detailsTag: ENVELOPE.tag,
    detailsKeyVersion: ENVELOPE.keyVersion,
    ...overrides,
  };
}

function createHarness(options: HarnessOptions = {}) {
  const calls: Array<{ delegate: string; args: unknown }> = [];
  const track = <T>(delegate: string, value: T) =>
    jest.fn((args: unknown) => {
      calls.push({ delegate, args });
      return Promise.resolve(value);
    });

  const prisma = {
    eventPreference: {
      findUnique: track("eventPreference.findUnique", options.preference ?? {
        id: "preference-1",
        ownerId: "owner-1",
        interestTagsCiphertext: ENVELOPE.ciphertext,
        interestTagsIv: ENVELOPE.iv,
        interestTagsTag: ENVELOPE.tag,
        interestTagsKeyVersion: ENVELOPE.keyVersion,
        maxDistanceKm: 50,
        travelSpeedKph: 30,
        travelBufferMinutes: 15,
      }),
    },
    calendarSource: {
      findMany: track("calendarSource.findMany", [
        {
          id: "calendar-source-1",
          ownerId: "owner-1",
          selected: true,
          fullSyncRequired: options.fullSyncRequired ?? false,
        },
      ]),
    },
    discoveredEvent: {
      findMany: track("discoveredEvent.findMany", options.events ?? [event()]),
    },
    contact: {
      findMany: track("contact.findMany", options.contacts ?? [
        {
          id: "contact-1",
          ownerId: "owner-1",
          isDemo: false,
          labels: ["ai"],
          tags: ["community"],
          groups: ["founders"],
        },
        {
          id: "contact-2",
          ownerId: "owner-1",
          isDemo: false,
          labels: ["ai"],
          tags: [],
          groups: [],
        },
      ]),
    },
    briefFeedback: {
      findMany: track("briefFeedback.findMany", options.feedback ?? []),
    },
    calendarEvent: {
      findMany: track("calendarEvent.findMany", options.calendarEvents ?? []),
    },
  };
  const cipher = {
    decrypt: jest.fn((purpose: string, _owner?: string, _id?: string) => {
      if (purpose === "event-preference-interest-tags") return ["AI", "Private"];
      if (purpose === "calendar-event-details") {
        return { summary: "Busy", locationText: null, selfResponseStatus: "accepted" };
      }
      throw new Error(`unexpected decrypt ${purpose}`);
    }),
  };
  const location = {
    resolveForEvent: jest.fn().mockResolvedValue({
      source: "calendar",
      freshness: "planned",
      city: "Dubai",
      countryCode: "AE",
      timeZone: "Asia/Dubai",
      distanceCapability: false,
      lastSeenAt: null,
      origin: null,
    }),
  };
  const service = new EventRecommendationService(
    prisma as never,
    cipher as never,
    location as never
  );
  return { service, prisma, cipher, location, calls };
}

describe("EventRecommendationService", () => {
  it("fails closed before candidate reads when any selected calendar source needs a full sync", async () => {
    const harness = createHarness({ fullSyncRequired: true });

    await expect(harness.service.recommend("owner-1", NOW)).resolves.toEqual([]);

    expect(harness.prisma.discoveredEvent.findMany).not.toHaveBeenCalled();
    expect(harness.prisma.calendarSource.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId: "owner-1", selected: true },
      })
    );
  });

  it("returns at most three redacted planned event items from owner-scoped bounded reads", async () => {
    const harness = createHarness({
      events: [
        event({ id: "event-4", title: "Fourth", startAt: new Date("2026-07-16T21:00:00.000Z"), endAt: new Date("2026-07-16T22:00:00.000Z") }),
        event({ id: "event-1", title: "First" }),
        event({ id: "event-2", title: "Second", startAt: new Date("2026-07-16T19:00:00.000Z"), endAt: new Date("2026-07-16T20:00:00.000Z") }),
        event({ id: "event-3", title: "Third", startAt: new Date("2026-07-16T20:00:00.000Z"), endAt: new Date("2026-07-16T21:00:00.000Z") }),
      ],
    });

    const planned = await harness.service.recommend("owner-1", NOW);

    expect(planned).toHaveLength(3);
    expect(planned[0]).toMatchObject({
      kind: "event",
      contactId: null,
      sourceType: "discovered_event",
      sourceId: expect.any(String),
      rank: 1,
      title: expect.any(String),
      startAt: expect.any(Date),
      endAt: expect.any(Date),
      city: "Dubai",
      evidence: expect.objectContaining({
        conflict: "clear",
        context: { source: "calendar", freshness: "planned" },
        plannedCity: "Dubai",
      }),
    });
    const serialized = JSON.stringify(planned);
    expect(serialized).not.toContain("Private");
    expect(serialized).not.toContain("origin");
    expect(serialized).not.toContain("latitude");
    expect(serialized).not.toContain("longitude");
    expect(serialized).not.toContain("providerEventId");
    expect(serialized).not.toContain("calendar-1");
    for (const call of harness.calls) {
      expect(JSON.stringify(call.args)).toContain("owner-1");
      expect(JSON.stringify(call.args)).toMatch(/take|selected|ownerId/);
    }
  });

  it("filters busy calendar conflicts with symmetric travel padding and ignores transparent or declined rows", async () => {
    const clearTouchingEnd = new Date("2026-07-16T17:25:00.000Z");
    const oneMsOverlapEnd = new Date("2026-07-16T17:25:00.001Z");
    const harness = createHarness({
      calendarEvents: [
        calendarEvent({
          id: "transparent",
          startAt: new Date("2026-07-16T17:00:00.000Z"),
          endAt: oneMsOverlapEnd,
          transparency: "transparent",
        }),
        calendarEvent({
          id: "declined",
          startAt: new Date("2026-07-16T17:00:00.000Z"),
          endAt: oneMsOverlapEnd,
        }),
        calendarEvent({
          id: "touching",
          startAt: new Date("2026-07-16T17:00:00.000Z"),
          endAt: clearTouchingEnd,
        }),
      ],
    });
    harness.cipher.decrypt.mockImplementation((purpose: string, _owner: string, id: string) => {
      if (purpose === "event-preference-interest-tags") return ["AI"];
      if (id === "declined") {
        return { summary: "No", locationText: null, selfResponseStatus: "declined" };
      }
      return { summary: "Busy", locationText: null, selfResponseStatus: "accepted" };
    });

    await expect(harness.service.recommend("owner-1", NOW)).resolves.toHaveLength(1);

    harness.prisma.calendarEvent.findMany.mockResolvedValueOnce([
      calendarEvent({
        id: "overlap",
        startAt: new Date("2026-07-16T17:00:00.000Z"),
        endAt: oneMsOverlapEnd,
      }),
    ]);
    await expect(harness.service.recommend("owner-1", NOW)).resolves.toEqual([]);
  });

  it("uses feedback category from event item evidence instead of reclassifying current event edits", async () => {
    const harness = createHarness({
      events: [event({ id: "edited-event", category: "community" })],
      feedback: [
        {
          id: "feedback-1",
          action: "dismiss",
          createdAt: new Date("2026-07-10T10:00:00.000Z"),
          snoozedUntil: null,
          briefItem: {
            kind: "event",
            sourceType: "discovered_event",
            sourceId: "old-event",
            evidence: { category: "networking" },
          },
        },
        {
          id: "feedback-2",
          action: "dismiss",
          createdAt: new Date("2026-07-11T10:00:00.000Z"),
          snoozedUntil: null,
          briefItem: {
            kind: "event",
            sourceType: "discovered_event",
            sourceId: "older-event",
            evidence: { category: "networking" },
          },
        },
      ],
    });

    await expect(harness.service.recommend("owner-1", NOW)).resolves.toHaveLength(1);
  });
});
