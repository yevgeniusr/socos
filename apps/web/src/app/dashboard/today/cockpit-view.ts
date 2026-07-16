import type { BriefItemState, DailyBrief } from "@socos/agent-core";

type Quest = DailyBrief["quests"][number];

export function buildCockpitView(brief: DailyBrief) {
  const events = brief.schemaVersion === "1.1" ? brief.events : [];
  const questsByItem = brief.quests.reduce<Record<string, Quest[]>>(
    (grouped, quest) => {
      (grouped[quest.itemId] ??= []).push(quest);
      return grouped;
    },
    {}
  );
  const counts = {
    people: brief.people.length,
    dates: brief.dates.length,
    events: events.length,
    pendingQuests: brief.quests.filter((quest) => quest.status === "pending").length,
  };
  return {
    schemaVersion: brief.schemaVersion,
    events,
    questsByItem,
    counts,
    empty: counts.people + counts.dates + counts.events === 0,
  };
}

export function formatBriefDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function healthBandLabel(
  band: DailyBrief["people"][number]["health"]["band"]
): string {
  return {
    excellent: "Excellent",
    healthy: "Healthy",
    "needs-attention": "Needs attention",
    "at-risk": "At risk",
  }[band];
}

export function itemStateLabel(state: BriefItemState): string {
  return {
    pending: "Pending",
    accepted: "Kept",
    snoozed: "Snoozed",
    dismissed: "Dismissed",
  }[state];
}

export function momentumState(
  stats: "loading" | "ready" | "error",
  streak: "loading" | "ready" | "error"
): "loading" | "ready" | "unavailable" {
  if (stats === "error" || streak === "error") return "unavailable";
  if (stats === "loading" || streak === "loading") return "loading";
  return "ready";
}
