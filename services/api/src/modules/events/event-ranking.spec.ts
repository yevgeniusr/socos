import {
  distanceBand,
  rankEventCandidates,
  type EventRankingCandidate,
  type EventRankingFeedback,
} from "./event-ranking.js";

const NOW = new Date("2026-07-16T10:00:00.000Z");

function candidate(
  overrides: Partial<EventRankingCandidate> = {}
): EventRankingCandidate {
  return {
    id: "event-a",
    title: "Community systems dinner",
    startAt: new Date("2026-07-16T12:00:00.000Z"),
    endAt: new Date("2026-07-16T14:00:00.000Z"),
    city: "Dubai",
    countryCode: "AE",
    latitude: 25.2048,
    longitude: 55.2708,
    category: "community",
    tags: ["Community", "AI", "Founders", "Community"],
    sourceSocialWeight: 10,
    locationContext: {
      source: "sample",
      freshness: "fresh",
      city: "Abu Dhabi",
      countryCode: "AE",
      timeZone: "Asia/Dubai",
      distanceCapability: true,
      lastSeenAt: NOW,
      origin: { lat: 25.2048, lon: 55.2708 },
    },
    matchedContactCount: 2,
    ...overrides,
  };
}

function rankOne(
  overrides: Partial<EventRankingCandidate> = {},
  feedback: EventRankingFeedback[] = []
) {
  return rankEventCandidates({
    now: NOW,
    preferences: {
      interestTags: [" ai ", "founders", "private-only"],
      maxDistanceKm: 50,
      travelSpeedKph: 30,
      travelBufferMinutes: 15,
    },
    candidates: [candidate(overrides)],
    feedback,
  })[0];
}

describe("event ranking", () => {
  it.each([
    ["ongoing", NOW, new Date("2026-07-16T10:30:00.000Z"), 25],
    ["exactly 48h", new Date("2026-07-18T10:00:00.000Z"), new Date("2026-07-18T11:00:00.000Z"), 25],
    ["48h plus 1ms", new Date("2026-07-18T10:00:00.001Z"), new Date("2026-07-18T11:00:00.000Z"), 20],
    ["exactly 7d", new Date("2026-07-23T10:00:00.000Z"), new Date("2026-07-23T11:00:00.000Z"), 20],
    ["7d plus 1ms", new Date("2026-07-23T10:00:00.001Z"), new Date("2026-07-23T11:00:00.000Z"), 15],
    ["exactly 14d", new Date("2026-07-30T10:00:00.000Z"), new Date("2026-07-30T11:00:00.000Z"), 15],
    ["14d plus 1ms", new Date("2026-07-30T10:00:00.001Z"), new Date("2026-07-30T11:00:00.000Z"), 0],
  ])("scores time at the %s boundary", (_label, startAt, endAt, timeScore) => {
    expect(rankOne({ startAt, endAt }).evidence.components.time).toBe(timeScore);
  });

  it("uses exact coordinates before city mismatch and keeps max distance inclusive", () => {
    const ranked = rankOne({
      latitude: 25.654,
      longitude: 55.27,
      city: "Sharjah",
      locationContext: {
        source: "sample",
        freshness: "fresh",
        city: "Dubai",
        countryCode: "AE",
        timeZone: "Asia/Dubai",
        distanceCapability: true,
        lastSeenAt: NOW,
        origin: { lat: 25.2048, lon: 55.2708 },
      },
    });

    expect(ranked.evidence.components.distance).toBeGreaterThanOrEqual(0);
    expect(ranked.evidence.distanceBand).toBe("25-50");
  });

  it("excludes a known distance just beyond the maximum", () => {
    const ranked = rankEventCandidates({
      now: NOW,
      preferences: {
        interestTags: [],
        maxDistanceKm: 50,
        travelSpeedKph: 30,
        travelBufferMinutes: 15,
      },
      candidates: [
        candidate({
          latitude: 25.655,
          longitude: 55.8,
          locationContext: {
            source: "sample",
            freshness: "fresh",
            city: "Dubai",
            countryCode: "AE",
            timeZone: "Asia/Dubai",
            distanceCapability: true,
            lastSeenAt: NOW,
            origin: { lat: 25.2048, lon: 55.2708 },
          },
        }),
      ],
      feedback: [],
    });

    expect(ranked).toEqual([]);
  });

  it("uses same-city fallback distance and distance band boundaries", () => {
    const ranked = rankOne({
      latitude: null,
      longitude: null,
      city: " Dubai ",
      locationContext: {
        source: "calendar",
        freshness: "planned",
        city: "dubai",
        countryCode: "AE",
        timeZone: "Asia/Dubai",
        distanceCapability: false,
        lastSeenAt: null,
        origin: null,
      },
    });

    expect(ranked.evidence.components.distance).toBe(15);
    expect(ranked.evidence.distanceBand).toBe("10-25");
    expect(distanceBand(1.999)).toBe("<2");
    expect(distanceBand(2)).toBe("2-10");
    expect(distanceBand(10)).toBe("10-25");
    expect(distanceBand(50)).toBe("25-50");
    expect(distanceBand(50.001)).toBe(">50");
  });

  it("applies inclusive feedback cutoffs, active snooze, and category dismiss rules", () => {
    expect(
      rankEventCandidates({
        now: NOW,
        preferences: {
          interestTags: [],
          maxDistanceKm: 50,
          travelSpeedKph: 30,
          travelBufferMinutes: 15,
        },
        candidates: [candidate()],
        feedback: [
          {
            eventId: "event-a",
            category: "community",
            action: "dismiss",
            createdAt: new Date("2026-06-16T10:00:00.000Z"),
            snoozedUntil: null,
          },
        ],
      })
    ).toEqual([]);

    expect(
      rankEventCandidates({
        now: NOW,
        preferences: {
          interestTags: [],
          maxDistanceKm: 50,
          travelSpeedKph: 30,
          travelBufferMinutes: 15,
        },
        candidates: [candidate()],
        feedback: [
          {
            eventId: "event-a",
            category: "community",
            action: "dismiss",
            createdAt: new Date("2026-06-16T09:59:59.999Z"),
            snoozedUntil: null,
          },
          {
            eventId: "event-a",
            category: "community",
            action: "dismiss",
            createdAt: new Date("2026-07-16T10:00:00.001Z"),
            snoozedUntil: null,
          },
        ],
      })
    ).toHaveLength(1);

    expect(
      rankEventCandidates({
        now: NOW,
        preferences: {
          interestTags: [],
          maxDistanceKm: 50,
          travelSpeedKph: 30,
          travelBufferMinutes: 15,
        },
        candidates: [candidate({ id: "other", category: "community" })],
        feedback: [
          {
            eventId: "old-1",
            category: "community",
            action: "dismiss",
            createdAt: new Date("2026-06-16T10:00:00.000Z"),
            snoozedUntil: null,
          },
          {
            eventId: "old-2",
            category: "community",
            action: "dismiss",
            createdAt: new Date("2026-06-16T10:00:00.000Z"),
            snoozedUntil: null,
          },
        ],
      })
    ).toEqual([]);

    expect(
      rankEventCandidates({
        now: NOW,
        preferences: {
          interestTags: [],
          maxDistanceKm: 50,
          travelSpeedKph: 30,
          travelBufferMinutes: 15,
        },
        candidates: [candidate()],
        feedback: [
          {
            eventId: "event-a",
            category: "community",
            action: "snooze",
            createdAt: new Date("2026-07-15T10:00:00.000Z"),
            snoozedUntil: new Date("2026-07-16T10:00:00.001Z"),
          },
        ],
      })
    ).toEqual([]);
  });

  it("caps components, sorts deterministically, and omits private preference tags", () => {
    const ranked = rankEventCandidates({
      now: NOW,
      preferences: {
        interestTags: ["private-only", "ai", "community", "founders"],
        maxDistanceKm: 50,
        travelSpeedKph: 30,
        travelBufferMinutes: 15,
      },
      candidates: [
        candidate({ id: "event-c", startAt: new Date("2026-07-17T12:00:00.000Z") }),
        candidate({ id: "event-a", startAt: new Date("2026-07-17T12:00:00.000Z") }),
        candidate({
          id: "event-b",
          startAt: new Date("2026-07-16T12:00:00.000Z"),
          tags: ["ai", "community", "founders"],
          matchedContactCount: 20,
          sourceSocialWeight: 50,
        }),
      ],
      feedback: [],
    });

    expect(ranked.map((event) => event.id)).toEqual([
      "event-b",
      "event-a",
      "event-c",
    ]);
    expect(ranked[0].score).toBeLessThanOrEqual(100);
    expect(JSON.stringify(ranked)).not.toContain("private-only");
    expect(ranked[0].evidence.matchedTags).toEqual([
      "ai",
      "community",
      "founders",
    ]);
  });
});
