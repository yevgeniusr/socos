import type { DailyBrief, DailyBriefEventV1_1, DailyBriefV1 } from "@socos/agent-core";
import type { BriefItemStatus, QuestStatus } from "./briefs.types.js";

export type { DailyBrief, DailyBriefV1 } from "@socos/agent-core";

export type RelationshipHealthBand =
  DailyBriefV1["people"][number]["health"]["band"];

interface PersistedBriefItem {
  id: string;
  kind: string;
  rank: number;
  contactId: string | null;
  sourceType: string;
  sourceId: string | null;
  title: string;
  reason: string;
  status: string;
  evidence: unknown;
  eventStartAt?: Date | null;
  eventEndAt?: Date | null;
  eventCity?: string | null;
}

interface PersistedQuest {
  id: string;
  briefItemId: string;
  title: string;
  completionType: string;
  xpReward: number;
  status: string;
}

export interface PersistedBriefBatch {
  id: string;
  schemaVersion: string;
  localDate: Date;
  timeZone: string;
  status: string;
  generatedAt: Date | null;
  items: PersistedBriefItem[];
  quests: PersistedQuest[];
}

interface PersonEvidence {
  contactName: string;
  health: { score: number; band: RelationshipHealthBand };
  lastInteractionAt: string | null;
  reasonCode: string;
  signals: Array<{ code: string; value: string | number | null }>;
}

interface DateEvidence {
  contactName: string;
  date: string;
  daysAway: number;
}

const itemStatuses = new Set<BriefItemStatus>([
  "pending",
  "accepted",
  "snoozed",
  "dismissed",
]);
const healthBands = new Set<RelationshipHealthBand>([
  "excellent",
  "healthy",
  "needs-attention",
  "at-risk",
]);
const dateTypes = new Set([
  "birthday",
  "anniversary",
  "celebration",
  "reminder",
]);
const eventDistanceBands = new Set([
  "<2",
  "2-10",
  "10-25",
  "25-50",
  ">50",
  "unknown",
]);
const eventContextSources = new Set(["sample", "visit", "calendar", "fallback"]);
const eventContextFreshness = new Set(["fresh", "recent", "planned", "fallback"]);
const eventComponentKeys = [
  "time",
  "distance",
  "interests",
  "social",
  "contact",
  "novelty",
  "feedback",
];
const eventEvidenceKeys = [
  "components",
  "distanceBand",
  "conflict",
  "context",
  "matchedTags",
  "category",
  "plannedCity",
];

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid brief evidence");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  message: string
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(message);
  }
}

function itemStatus(value: string): BriefItemStatus {
  if (!itemStatuses.has(value as BriefItemStatus)) {
    throw new Error("Invalid brief item status");
  }
  return value as BriefItemStatus;
}

function personEvidence(value: unknown): PersonEvidence {
  const evidence = record(value);
  const health = record(evidence.health);
  if (
    typeof evidence.contactName !== "string" ||
    typeof health.score !== "number" ||
    !healthBands.has(health.band as RelationshipHealthBand) ||
    (evidence.lastInteractionAt !== null &&
      typeof evidence.lastInteractionAt !== "string") ||
    typeof evidence.reasonCode !== "string" ||
    !Array.isArray(evidence.signals)
  ) {
    throw new Error("Invalid person evidence");
  }

  const signals = evidence.signals.map((signal) => {
    const entry = record(signal);
    if (
      typeof entry.code !== "string" ||
      (!["string", "number"].includes(typeof entry.value) &&
        entry.value !== null)
    ) {
      throw new Error("Invalid person evidence signal");
    }
    return {
      code: entry.code,
      value: entry.value as string | number | null,
    };
  });

  return {
    contactName: evidence.contactName,
    health: {
      score: health.score,
      band: health.band as RelationshipHealthBand,
    },
    lastInteractionAt: evidence.lastInteractionAt as string | null,
    reasonCode: evidence.reasonCode,
    signals,
  };
}

function dateEvidence(value: unknown): DateEvidence {
  const evidence = record(value);
  if (
    typeof evidence.contactName !== "string" ||
    typeof evidence.date !== "string" ||
    typeof evidence.daysAway !== "number"
  ) {
    throw new Error("Invalid date evidence");
  }
  return {
    contactName: evidence.contactName,
    date: evidence.date,
    daysAway: evidence.daysAway,
  };
}

function eventEvidence(value: unknown): DailyBriefEventV1_1["evidence"] {
  const evidence = record(value);
  exactKeys(evidence, eventEvidenceKeys, "Invalid event evidence");
  const components = record(evidence.components);
  exactKeys(components, eventComponentKeys, "Invalid event evidence");
  const context = record(evidence.context);
  exactKeys(context, ["source", "freshness"], "Invalid event evidence");

  if (
    !eventComponentKeys.every((key) => typeof components[key] === "number") ||
    !eventDistanceBands.has(evidence.distanceBand as string) ||
    evidence.conflict !== "clear" ||
    !eventContextSources.has(context.source as string) ||
    !eventContextFreshness.has(context.freshness as string) ||
    !Array.isArray(evidence.matchedTags) ||
    !evidence.matchedTags.every((tag) => typeof tag === "string") ||
    (evidence.category !== null && typeof evidence.category !== "string") ||
    (evidence.plannedCity !== null && typeof evidence.plannedCity !== "string")
  ) {
    throw new Error("Invalid event evidence");
  }

  return {
    components: Object.fromEntries(
      eventComponentKeys.map((key) => [key, components[key] as number])
    ) as DailyBriefEventV1_1["evidence"]["components"],
    distanceBand:
      evidence.distanceBand as DailyBriefEventV1_1["evidence"]["distanceBand"],
    conflict: "clear",
    context: {
      source: context.source as DailyBriefEventV1_1["evidence"]["context"]["source"],
      freshness:
        context.freshness as DailyBriefEventV1_1["evidence"]["context"]["freshness"],
    },
    matchedTags: evidence.matchedTags as string[],
    category: evidence.category as string | null,
    plannedCity: evidence.plannedCity as string | null,
  };
}

export function presentBrief(batch: PersistedBriefBatch): DailyBrief {
  if (
    batch.status !== "ready" ||
    !batch.generatedAt ||
    (batch.schemaVersion !== "1.0" && batch.schemaVersion !== "1.1")
  ) {
    throw new Error("Brief batch is not ready");
  }

  const people = batch.items
    .filter((item) => item.kind === "person")
    .sort(
      (left, right) => left.rank - right.rank || left.id.localeCompare(right.id)
    )
    .map((item) => {
      const evidence = personEvidence(item.evidence);
      const contactId = item.contactId ?? item.sourceId;
      if (!contactId) throw new Error("Person brief item has no contact");
      return {
        itemId: item.id,
        rank: item.rank,
        contact: { id: contactId, name: evidence.contactName },
        health: evidence.health,
        lastInteractionAt: evidence.lastInteractionAt,
        reason: item.reason,
        evidence: evidence.signals,
        state: itemStatus(item.status),
      };
    });

  const dates = batch.items
    .filter((item) => item.kind === "date")
    .sort(
      (left, right) => left.rank - right.rank || left.id.localeCompare(right.id)
    )
    .map((item) => {
      const evidence = dateEvidence(item.evidence);
      if (!item.contactId || !dateTypes.has(item.sourceType)) {
        throw new Error("Invalid date brief item");
      }
      return {
        itemId: item.id,
        rank: item.rank,
        contact: { id: item.contactId, name: evidence.contactName },
        type: item.sourceType as DailyBriefV1["dates"][number]["type"],
        title: item.title,
        date: evidence.date,
        daysAway: evidence.daysAway,
        reason: item.reason,
        state: itemStatus(item.status),
      };
    });

  const events =
    batch.schemaVersion === "1.1"
      ? batch.items
          .filter((item) => item.kind === "event")
          .sort(
            (left, right) =>
              left.rank - right.rank || left.id.localeCompare(right.id)
          )
          .map((item) => {
            if (
              item.contactId !== null ||
              item.sourceType !== "discovered_event" ||
              !item.sourceId ||
              !item.eventStartAt ||
              !item.eventEndAt ||
              item.eventEndAt <= item.eventStartAt
            ) {
              throw new Error("Invalid event brief item");
            }
            return {
              itemId: item.id,
              rank: item.rank,
              source: { type: "discovered_event" as const, id: item.sourceId },
              title: item.title,
              startsAt: item.eventStartAt.toISOString(),
              endsAt: item.eventEndAt.toISOString(),
              city: item.eventCity ?? null,
              reason: item.reason,
              evidence: eventEvidence(item.evidence),
              state: itemStatus(item.status),
            };
          })
      : [];

  const itemOrder = new Map(
    batch.items.map((item) => [
      item.id,
      {
        kind: item.kind === "person" ? 0 : item.kind === "date" ? 1 : 2,
        rank: item.rank,
      },
    ])
  );
  const quests = [...batch.quests]
    .sort((left, right) => {
      const leftOrder = itemOrder.get(left.briefItemId) ?? {
        kind: 2,
        rank: Number.MAX_SAFE_INTEGER,
      };
      const rightOrder = itemOrder.get(right.briefItemId) ?? {
        kind: 2,
        rank: Number.MAX_SAFE_INTEGER,
      };
      return (
        leftOrder.kind - rightOrder.kind ||
        leftOrder.rank - rightOrder.rank ||
        left.id.localeCompare(right.id)
      );
    })
    .map((quest) => {
      if (
        !["interaction", "reminder"].includes(quest.completionType) ||
        !["pending", "completed"].includes(quest.status)
      ) {
        throw new Error("Invalid brief quest");
      }
      return {
        questId: quest.id,
        itemId: quest.briefItemId,
        title: quest.title,
        completionType: quest.completionType as "interaction" | "reminder",
        xpReward: quest.xpReward,
        status: quest.status as QuestStatus,
      };
    });

  const base: DailyBriefV1 = {
    schemaVersion: "1.0",
    briefId: batch.id,
    localDate: batch.localDate.toISOString().slice(0, 10),
    timeZone: batch.timeZone,
    generatedAt: batch.generatedAt.toISOString(),
    people,
    dates,
    quests,
    allowedActions: ["accept", "snooze", "dismiss", "complete"],
  };
  if (batch.schemaVersion === "1.0") return base;
  return {
    schemaVersion: "1.1",
    briefId: batch.id,
    localDate: batch.localDate.toISOString().slice(0, 10),
    timeZone: batch.timeZone,
    generatedAt: batch.generatedAt.toISOString(),
    people,
    dates,
    events,
    quests,
    allowedActions: ["accept", "snooze", "dismiss", "complete"],
  };
}
