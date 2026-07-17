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
  timeZone: string;
}

export type ReminderRequestBody = {
  contactId: string;
  type: ReminderDraft["type"];
  title: string;
  scheduledAt: string;
};

export interface ReminderReceipt {
  contact: ReminderDraft["contact"];
  type: ReminderRequestBody["type"];
  title: string;
  scheduledAt: string;
  timeZone: string;
}

export interface QuestCompletionResult {
  questId: string;
  status: "completed";
  completedAt: string;
  xpAwarded: number;
}

export interface QuestReceipt {
  questId: string;
  title: string;
  evidenceType: "interaction" | "reminder";
  verifiedAt: string;
  xpAwarded: number;
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
  const signal = (code: string) =>
    item.evidence.find((entry) => entry.code === code)?.value;
  const pendingTasks = signal("pending_task_count");
  const importantDateDays = signal("important_date_days");
  const daysOverdue = signal("days_overdue");
  const context =
    typeof pendingTasks === "number" && pendingTasks > 0
      ? `${pendingTasks} unfinished ${pendingTasks === 1 ? "commitment" : "commitments"}`
      : typeof importantDateDays === "number" && importantDateDays >= 0
        ? importantDateDays === 0
          ? "Important date today"
          : `Important date in ${importantDateDays} ${importantDateDays === 1 ? "day" : "days"}`
        : typeof daysOverdue === "number" && daysOverdue > 0
          ? `${daysOverdue} ${daysOverdue === 1 ? "day" : "days"} overdue`
          : item.reason.trim() || null;
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

function zonedParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: number("year"),
    month: number("month"),
    day: number("day"),
    hour: number("hour"),
    minute: number("minute"),
    second: number("second"),
  };
}

export function zonedLocalDateTimeToIso(
  value: string,
  timeZone: string
): string {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Reminder time is invalid");
  const desired = match.slice(1).map(Number);
  const desiredUtc = Date.UTC(
    desired[0],
    desired[1] - 1,
    desired[2],
    desired[3],
    desired[4],
    0
  );
  let candidate = desiredUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedParts(new Date(candidate), timeZone);
    const represented = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    candidate += desiredUtc - represented;
  }
  const roundTrip = zonedParts(new Date(candidate), timeZone);
  if (
    roundTrip.year !== desired[0] ||
    roundTrip.month !== desired[1] ||
    roundTrip.day !== desired[2] ||
    roundTrip.hour !== desired[3] ||
    roundTrip.minute !== desired[4]
  ) {
    throw new Error("Reminder time does not exist in the selected timezone");
  }
  return new Date(candidate).toISOString();
}

export function buildPersonReminderDraft(
  item: PersonItem,
  timeZone: string,
  now = new Date()
): ReminderDraft {
  const today = zonedParts(now, timeZone);
  const tomorrow = new Date(
    Date.UTC(today.year, today.month - 1, today.day + 1, 12)
  )
    .toISOString()
    .slice(0, 10);
  return {
    contact: item.contact,
    type: "followup",
    title: `Follow up with ${item.contact.name}`,
    scheduledAt: `${tomorrow}T09:00`,
    sourceLabel: item.reason,
    timeZone,
  };
}

export function buildPersonReminderDraftFromDates(
  item: PersonItem,
  dates: DateItem[],
  timeZone: string,
  now = new Date()
): ReminderDraft {
  const importantDateDays = item.evidence.find(
    (entry) => entry.code === "important_date_days"
  )?.value;
  const matchingDate =
    typeof importantDateDays === "number"
      ? dates.find(
          (date) =>
            date.contact.id === item.contact.id &&
            date.daysAway === importantDateDays
        )
      : undefined;
  return matchingDate
    ? buildDateReminderDraft(matchingDate, timeZone)
    : buildPersonReminderDraft(item, timeZone, now);
}

export function buildDateReminderDraft(
  item: DateItem,
  timeZone: string
): ReminderDraft {
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
    timeZone,
  };
}

export function buildReminderReceipt(
  body: ReminderRequestBody,
  contact: ReminderDraft["contact"],
  timeZone: string
): ReminderReceipt {
  return {
    contact,
    type: body.type,
    title: body.title,
    scheduledAt: body.scheduledAt,
    timeZone,
  };
}

export function buildQuestReceipt(
  quest: Quest,
  evidenceType: QuestReceipt["evidenceType"],
  result: QuestCompletionResult
): QuestReceipt {
  if (
    result.questId !== quest.questId ||
    result.status !== "completed" ||
    evidenceType !== quest.completionType ||
    !Number.isFinite(result.xpAwarded) ||
    result.xpAwarded < 0 ||
    Number.isNaN(Date.parse(result.completedAt))
  ) {
    throw new Error("Quest verification response does not match the request");
  }
  return {
    questId: result.questId,
    title: quest.title,
    evidenceType,
    verifiedAt: result.completedAt,
    xpAwarded: result.xpAwarded,
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
