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
});
