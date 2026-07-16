import { presentBrief } from "./briefs.presenter.js";

describe("presentBrief", () => {
  it("returns the stable Daily Brief v1 shape without persistence fields", () => {
    const result = presentBrief({
      id: "brief-1",
      schemaVersion: "1.0",
      localDate: new Date("2026-07-16T00:00:00.000Z"),
      timeZone: "UTC",
      status: "ready",
      generatedAt: new Date("2026-07-16T08:00:00.000Z"),
      items: [
        {
          id: "person-item",
          kind: "person",
          rank: 1,
          contactId: "contact-1",
          sourceType: "contact",
          sourceId: "contact-1",
          title: "Synthetic Person",
          reason: "Preferred check-in cadence is overdue by 12 days.",
          status: "pending",
          evidence: {
            contactName: "Synthetic Person",
            health: { score: 42, band: "needs-attention" },
            lastInteractionAt: "2026-05-01T10:00:00.000Z",
            reasonCode: "cadence_overdue",
            signals: [
              { code: "days_overdue", value: 12 },
              { code: "importance", value: 4 },
            ],
          },
        },
        {
          id: "date-item",
          kind: "date",
          rank: 1,
          contactId: "contact-1",
          sourceType: "birthday",
          sourceId: "contact-1",
          title: "Synthetic Person's birthday",
          reason: "Synthetic Person's birthday is in 3 days",
          status: "accepted",
          evidence: {
            contactName: "Synthetic Person",
            date: "2026-07-19",
            daysAway: 3,
          },
        },
      ],
      quests: [
        {
          id: "quest-1",
          briefItemId: "person-item",
          title: "Reach out to Synthetic Person",
          completionType: "interaction",
          xpReward: 15,
          status: "pending",
        },
      ],
    });

    expect(result).toEqual({
      schemaVersion: "1.0",
      briefId: "brief-1",
      localDate: "2026-07-16",
      timeZone: "UTC",
      generatedAt: "2026-07-16T08:00:00.000Z",
      people: [
        {
          itemId: "person-item",
          rank: 1,
          contact: { id: "contact-1", name: "Synthetic Person" },
          health: { score: 42, band: "needs-attention" },
          lastInteractionAt: "2026-05-01T10:00:00.000Z",
          reason: "Preferred check-in cadence is overdue by 12 days.",
          evidence: [
            { code: "days_overdue", value: 12 },
            { code: "importance", value: 4 },
          ],
          state: "pending",
        },
      ],
      dates: [
        {
          itemId: "date-item",
          rank: 1,
          contact: { id: "contact-1", name: "Synthetic Person" },
          type: "birthday",
          title: "Synthetic Person's birthday",
          date: "2026-07-19",
          daysAway: 3,
          reason: "Synthetic Person's birthday is in 3 days",
          state: "accepted",
        },
      ],
      quests: [
        {
          questId: "quest-1",
          itemId: "person-item",
          title: "Reach out to Synthetic Person",
          completionType: "interaction",
          xpReward: 15,
          status: "pending",
        },
      ],
      allowedActions: ["accept", "snooze", "dismiss", "complete"],
    });
    expect(result).not.toHaveProperty("status");
  });

  it("refuses to present a non-ready or incomplete batch", () => {
    expect(() =>
      presentBrief({
        id: "brief-generating",
        schemaVersion: "1.0",
        localDate: new Date("2026-07-16T00:00:00.000Z"),
        timeZone: "UTC",
        status: "generating",
        generatedAt: null,
        items: [],
        quests: [],
      })
    ).toThrow("Brief batch is not ready");
  });

  it("presents schema 1.1 event items from immutable snapshot columns in explicit person/date/event order", () => {
    const result = presentBrief({
      id: "brief-1",
      schemaVersion: "1.1",
      localDate: new Date("2026-07-16T00:00:00.000Z"),
      timeZone: "UTC",
      status: "ready",
      generatedAt: new Date("2026-07-16T08:00:00.000Z"),
      items: [
        {
          id: "event-item",
          kind: "event",
          rank: 1,
          contactId: null,
          sourceType: "discovered_event",
          sourceId: "event-1",
          title: "Synthetic public event",
          reason: "A public event matches your interests.",
          status: "pending",
          eventStartAt: new Date("2026-07-18T18:00:00.000Z"),
          eventEndAt: new Date("2026-07-18T20:00:00.000Z"),
          eventCity: "Dubai",
          evidence: {
            components: {
              time: 20,
              distance: 15,
              interests: 5,
              social: 8,
              contact: 2,
              novelty: 10,
              feedback: 0,
            },
            distanceBand: "2-10",
            conflict: "clear",
            context: { source: "calendar", freshness: "planned" },
            matchedTags: ["networking", "founders"],
            category: "community",
            plannedCity: "Dubai",
          },
        },
        {
          id: "date-item",
          kind: "date",
          rank: 1,
          contactId: "contact-1",
          sourceType: "birthday",
          sourceId: "contact-1",
          title: "Synthetic Person's birthday",
          reason: "Synthetic Person's birthday is in 3 days",
          status: "accepted",
          evidence: {
            contactName: "Synthetic Person",
            date: "2026-07-19",
            daysAway: 3,
          },
        },
        {
          id: "person-item",
          kind: "person",
          rank: 1,
          contactId: "contact-1",
          sourceType: "contact",
          sourceId: "contact-1",
          title: "Synthetic Person",
          reason: "Preferred check-in cadence is overdue by 12 days.",
          status: "pending",
          evidence: {
            contactName: "Synthetic Person",
            health: { score: 42, band: "needs-attention" },
            lastInteractionAt: "2026-05-01T10:00:00.000Z",
            reasonCode: "cadence_overdue",
            signals: [{ code: "days_overdue", value: 12 }],
          },
        },
      ],
      quests: [],
    });

    expect(Object.keys(result)).toEqual([
      "schemaVersion",
      "briefId",
      "localDate",
      "timeZone",
      "generatedAt",
      "people",
      "dates",
      "events",
      "quests",
      "allowedActions",
    ]);
    expect(result).toMatchObject({
      schemaVersion: "1.1",
      events: [
        {
          itemId: "event-item",
          rank: 1,
          source: { type: "discovered_event", id: "event-1" },
          title: "Synthetic public event",
          startsAt: "2026-07-18T18:00:00.000Z",
          endsAt: "2026-07-18T20:00:00.000Z",
          city: "Dubai",
          reason: "A public event matches your interests.",
          evidence: {
            components: {
              time: 20,
              distance: 15,
              interests: 5,
              social: 8,
              contact: 2,
              novelty: 10,
              feedback: 0,
            },
            distanceBand: "2-10",
            conflict: "clear",
            context: { source: "calendar", freshness: "planned" },
            matchedTags: ["networking", "founders"],
            category: "community",
            plannedCity: "Dubai",
          },
          state: "pending",
        },
      ],
    });
  });

  it("rejects event evidence with hidden or invalid fields", () => {
    const batch = {
      id: "brief-1",
      schemaVersion: "1.1",
      localDate: new Date("2026-07-16T00:00:00.000Z"),
      timeZone: "UTC",
      status: "ready",
      generatedAt: new Date("2026-07-16T08:00:00.000Z"),
      items: [
        {
          id: "event-item",
          kind: "event",
          rank: 1,
          contactId: null,
          sourceType: "discovered_event",
          sourceId: "event-1",
          title: "Synthetic public event",
          reason: "A public event matches your interests.",
          status: "pending",
          eventStartAt: new Date("2026-07-18T18:00:00.000Z"),
          eventEndAt: new Date("2026-07-18T20:00:00.000Z"),
          eventCity: "Dubai",
          evidence: {
            components: {
              time: 20,
              distance: 15,
              interests: 5,
              social: 8,
              contact: 2,
              novelty: 10,
              feedback: 0,
            },
            distanceBand: "2-10",
            conflict: "clear",
            context: { source: "calendar", freshness: "planned" },
            matchedTags: ["networking"],
            category: "community",
            plannedCity: "Dubai",
            hiddenExactAddress: "private",
          },
        },
      ],
      quests: [],
    };

    expect(() => presentBrief(batch)).toThrow("Invalid event evidence");
    expect(() =>
      presentBrief({
        ...batch,
        items: [
          {
            ...batch.items[0],
            evidence: { ...batch.items[0].evidence, matchedTags: [123] },
          },
        ],
      })
    ).toThrow("Invalid event evidence");
  });
});
