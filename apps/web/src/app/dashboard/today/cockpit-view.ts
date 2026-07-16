import type { BriefItemState, DailyBrief } from "@socos/agent-core";

type Quest = DailyBrief["quests"][number];
type PersonItem = DailyBrief["people"][number];
type DateItem = DailyBrief["dates"][number];

export interface ReminderDraft {
  contact: { id: string; name: string };
  type: "birthday" | "followup" | "anniversary" | "custom";
  title: string;
  scheduledAt: string;
  sourceLabel: string;
}

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

export function personPriorityLabel(item: PersonItem): string {
  const daysOverdue = item.evidence.find(
    (signal) => signal.code === "days_overdue"
  )?.value;
  const context =
    typeof daysOverdue === "number" && daysOverdue > 0
      ? `${daysOverdue} ${daysOverdue === 1 ? "day" : "days"} overdue`
      : null;
  return [healthBandLabel(item.health.band), context].filter(Boolean).join(" · ");
}

export function lastInteractionLabel(
  value: string | null,
  timeZone: string
): string {
  if (!value) return "No interaction logged";
  return `Last contact ${new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))}`;
}

function localDateTimeInput(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function buildPersonReminderDraft(
  item: PersonItem,
  now = new Date()
): ReminderDraft {
  const scheduled = new Date(now);
  scheduled.setDate(scheduled.getDate() + 1);
  scheduled.setHours(9, 0, 0, 0);
  return {
    contact: item.contact,
    type: "followup",
    title: `Follow up with ${item.contact.name}`,
    scheduledAt: localDateTimeInput(scheduled),
    sourceLabel: item.reason,
  };
}

export function buildDateReminderDraft(item: DateItem): ReminderDraft {
  const type =
    item.type === "birthday" || item.type === "anniversary"
      ? item.type
      : "custom";
  const sourceType =
    item.type === "birthday"
      ? "Birthday"
      : item.type === "anniversary"
        ? "Anniversary"
        : item.type === "celebration"
          ? "Celebration"
          : "Important date";
  const formattedDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${item.date}T12:00:00.000Z`));
  return {
    contact: item.contact,
    type,
    title: item.title,
    scheduledAt: `${item.date}T09:00`,
    sourceLabel: `${sourceType} · ${formattedDate}`,
  };
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
