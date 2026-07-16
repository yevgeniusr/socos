import type { DailyBrief } from "@socos/agent-core";
import { describe, expect, it } from "vitest";

import {
  buildCockpitView,
  formatBriefDate,
  healthBandLabel,
  itemStateLabel,
  momentumState,
} from "./cockpit-view";

const baseBrief: DailyBrief = {
  schemaVersion: "1.0",
  briefId: "brief-synthetic",
  localDate: "2026-07-17",
  timeZone: "Asia/Dubai",
  generatedAt: "2026-07-17T05:00:00.000Z",
  people: [
    {
      itemId: "person-item",
      rank: 1,
      contact: { id: "contact-synthetic", name: "Synthetic Person" },
      health: { score: 42, band: "needs-attention" },
      lastInteractionAt: null,
      reason: "Synthetic reason",
      evidence: [],
      state: "pending",
    },
  ],
  dates: [],
  quests: [
    {
      questId: "quest-synthetic",
      itemId: "person-item",
      title: "Synthetic quest",
      completionType: "interaction",
      xpReward: 20,
      status: "pending",
    },
  ],
  allowedActions: ["accept", "snooze", "dismiss", "complete"],
};

describe("cockpit view", () => {
  it("associates quests with items and summarizes the loaded brief", () => {
    expect(buildCockpitView(baseBrief)).toMatchObject({
      schemaVersion: "1.0",
      events: [],
      counts: { people: 1, dates: 0, events: 0, pendingQuests: 1 },
      questsByItem: { "person-item": [baseBrief.quests[0]] },
      empty: false,
    });
  });

  it("preserves ordered V1.1 events and recognizes a ready empty brief", () => {
    const events = [
      {
        itemId: "event-2",
        rank: 2,
        source: { type: "discovered_event" as const, id: "source-2" },
        title: "Second event",
        startsAt: "2026-07-18T10:00:00.000Z",
        endsAt: "2026-07-18T11:00:00.000Z",
        city: "Dubai",
        reason: "Synthetic event",
        evidence: {
          components: { time: 1, distance: 1, interests: 1, social: 1, contact: 1, novelty: 1, feedback: 1 },
          distanceBand: "2-10" as const,
          conflict: "clear" as const,
          context: { source: "fallback" as const, freshness: "fallback" as const },
          matchedTags: [],
          category: null,
          plannedCity: null,
        },
        state: "pending" as const,
      },
      {
        itemId: "event-1",
        rank: 1,
        source: { type: "discovered_event" as const, id: "source-1" },
        title: "First event",
        startsAt: "2026-07-18T08:00:00.000Z",
        endsAt: "2026-07-18T09:00:00.000Z",
        city: null,
        reason: "Synthetic event",
        evidence: {
          components: { time: 1, distance: 1, interests: 1, social: 1, contact: 1, novelty: 1, feedback: 1 },
          distanceBand: "unknown" as const,
          conflict: "clear" as const,
          context: { source: "sample" as const, freshness: "fresh" as const },
          matchedTags: [],
          category: null,
          plannedCity: null,
        },
        state: "pending" as const,
      },
    ];
    const view = buildCockpitView({
      ...baseBrief,
      schemaVersion: "1.1",
      people: [],
      quests: [],
      events,
    });
    expect(view.events.map((event) => event.itemId)).toEqual(["event-2", "event-1"]);
    expect(view.empty).toBe(false);

    expect(buildCockpitView({ ...baseBrief, people: [], quests: [] }).empty).toBe(true);
  });

  it("uses text labels and the brief timezone", () => {
    expect(healthBandLabel("needs-attention")).toBe("Needs attention");
    expect(itemStateLabel("snoozed")).toBe("Snoozed");
    expect(formatBriefDate("2026-07-17T21:30:00.000Z", "Asia/Dubai")).toContain("Jul 18");
  });

  it("never turns loading or failed momentum into real zero values", () => {
    expect(momentumState("loading", "loading")).toBe("loading");
    expect(momentumState("error", "ready")).toBe("unavailable");
    expect(momentumState("ready", "error")).toBe("unavailable");
    expect(momentumState("ready", "ready")).toBe("ready");
  });
});
