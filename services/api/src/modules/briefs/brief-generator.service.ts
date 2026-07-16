import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { EventRecommendationService } from "../events/event-recommendation.service.js";
import type { PlannedEventRecommendation } from "../events/event-recommendation.service.js";
import { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { dateKeyToUtcDate, localDateKey } from "./brief-time.js";
import {
  ImportantDatesService,
  type ImportantDateCandidate,
} from "./important-dates.service.js";
import {
  assessRelationship,
  rankRelationship,
  type RelationshipHealth,
} from "./relationship-health.js";
import {
  presentBrief,
  type DailyBrief,
  type PersistedBriefBatch,
} from "./briefs.presenter.js";

const CONTACT_PAGE_SIZE = 100;
const FEEDBACK_PAGE_SIZE = 100;
const QUEST_PAGE_SIZE = 100;
const SERIALIZATION_RETRY_LIMIT = 2;
const DATE_HORIZON_DAYS = 14;
const DATE_ITEM_LIMIT = 5;
const PERSON_ITEM_LIMIT = 3;
const QUEST_LIMIT = 4;
const DISMISS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

const batchInclude = {
  items: { orderBy: [{ kind: "asc" as const }, { rank: "asc" as const }] },
  quests: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
};

interface ContactCandidate {
  id: string;
  ownerId: string;
  isDemo: boolean;
  firstName: string;
  lastName: string | null;
  importance: number;
  preferredCadenceDays: number;
  lastContactedAt: Date | null;
  interactions: Array<{ occurredAt: Date }>;
  tasks: Array<{ id: string }>;
}

interface RankedPerson {
  contact: ContactCandidate;
  contactName: string;
  health: RelationshipHealth;
  score: number;
  lastInteractionAt: Date | null;
  reason: string;
  signals: Array<{ code: string; value: string | number | null }>;
}

interface PlannedItem {
  kind: "person" | "date" | "event";
  contactId: string | null;
  sourceType: string;
  sourceId: string;
  rank: number;
  score: number;
  title: string;
  reason: string;
  evidence: Record<string, unknown>;
  eventStartAt?: Date | null;
  eventEndAt?: Date | null;
  eventCity?: string | null;
  quest?: {
    title: string;
    completionType: "interaction" | "reminder";
    targetId: string;
    xpReward: 15 | 20;
  };
}

function contactName(
  contact: Pick<ContactCandidate, "firstName" | "lastName">
): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}

function reasonFor(
  health: RelationshipHealth,
  pendingTaskCount: number,
  importantDate: ImportantDateCandidate | undefined
): string {
  if (health.reasonCode === "never_contacted") {
    return "No interaction has been recorded yet.";
  }
  if (health.reasonCode === "cadence_overdue") {
    return `Preferred check-in cadence is overdue by ${health.daysOverdue} days.`;
  }
  if (pendingTaskCount > 0) {
    return "There is an unfinished commitment linked to this contact.";
  }
  if (importantDate) {
    return `${importantDate.title} is in ${importantDate.daysAway} days.`;
  }
  if (health.reasonCode === "cadence_due") {
    return "Preferred check-in cadence is due today.";
  }
  return "The relationship is within its preferred check-in cadence.";
}

function isUniqueConflict(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: string }).code === "P2002"
  );
}

function isSerializationConflict(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { code?: string }).code === "P2034"
  );
}

function questTargetKey(completionType: string, targetId: string): string {
  return `${completionType}:${targetId}`;
}

@Injectable()
export class BriefGeneratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly importantDates: ImportantDatesService,
    private readonly eventRecommendations: EventRecommendationService,
    private readonly personalDataConfig: PersonalDataConfigService
  ) {}

  async generateForOwner(ownerId: string, now: Date): Promise<DailyBrief> {
    let retryCount = 0;
    while (true) {
      try {
        return await this.generateAttempt(ownerId, now);
      } catch (error) {
        if (
          !isSerializationConflict(error) ||
          retryCount >= SERIALIZATION_RETRY_LIMIT
        ) {
          throw error;
        }
        retryCount += 1;
      }
    }
  }

  private async generateAttempt(
    ownerId: string,
    now: Date
  ): Promise<DailyBrief> {
    const owner = await this.loadOwner(ownerId);
    const localDate = dateKeyToUtcDate(localDateKey(now, owner.timeZone));
    const existing = await this.findBatch(ownerId, localDate);
    if (existing?.status === "ready") return presentBrief(existing);

    const [rawContacts, collectedDates, pendingQuestTargets] =
      await Promise.all([
        this.loadContacts(ownerId),
        this.importantDates.collect(
          ownerId,
          now,
          owner.timeZone,
          DATE_HORIZON_DAYS
        ),
        this.loadPendingQuestTargets(ownerId),
      ]);
    const contacts = rawContacts.filter(
      (contact) => contact.ownerId === ownerId && !contact.isDemo
    );
    const dates = collectedDates
      .filter(
        (candidate) =>
          candidate.daysAway >= 0 && candidate.daysAway <= DATE_HORIZON_DAYS
      )
      .slice(0, DATE_ITEM_LIMIT);
    const excludedContactIds = await this.loadExcludedContactIds(
      ownerId,
      contacts.map((contact) => contact.id),
      now
    );
    const rankedPeople = this.rankPeople(
      contacts.filter((contact) => !excludedContactIds.has(contact.id)),
      collectedDates,
      now
    ).slice(0, PERSON_ITEM_LIMIT);
    const plannedItems = this.planItems(
      rankedPeople,
      dates,
      pendingQuestTargets
    );
    const eventBriefEnabled = this.personalDataConfig.isEnabled("eventBrief");

    try {
      const batch = await this.prisma.$transaction(
        async (tx) => {
          if (existing?.status === "generating") {
            await tx.briefBatch.deleteMany({
              where: { id: existing.id, ownerId, status: "generating" },
            });
          }

          const plannedQuestTargets = new Set(
            plannedItems.flatMap((item) =>
              item.quest
                ? [
                    questTargetKey(
                      item.quest.completionType,
                      item.quest.targetId
                    ),
                  ]
                : []
            )
          );
          const pendingQuestTargetsAtWrite =
            await this.loadPendingQuestTargetsInTransaction(
              tx,
              ownerId,
              plannedQuestTargets
            );
          const plannedEvents = eventBriefEnabled
            ? await this.planEventItems(
                await this.eventRecommendations.recommend(ownerId, now, tx)
              )
            : [];
          const itemsToPersist = [...plannedItems, ...plannedEvents];

          const createdBatch = await tx.briefBatch.create({
            data: {
              ownerId,
              localDate,
              timeZone: owner.timeZone,
              status: "generating",
              schemaVersion: eventBriefEnabled ? "1.1" : "1.0",
            },
          });
          const persistedItems: Array<{ plan: PlannedItem; id: string }> = [];
          for (const item of itemsToPersist) {
            const persisted = await tx.briefItem.create({
              data: {
                batchId: createdBatch.id,
                ownerId,
                contactId: item.contactId,
                kind: item.kind,
                sourceType: item.sourceType,
                sourceId: item.sourceId,
                rank: item.rank,
                score: item.score,
                title: item.title,
                reason: item.reason,
                evidence: item.evidence as Prisma.InputJsonObject,
                eventStartAt: item.eventStartAt,
                eventEndAt: item.eventEndAt,
                eventCity: item.eventCity,
                status: "pending",
              },
            });
            persistedItems.push({ plan: item, id: persisted.id });
          }

          const questItems = persistedItems
            .filter(({ plan }) => {
              if (!plan.quest) return false;
              return !pendingQuestTargetsAtWrite.has(
                questTargetKey(plan.quest.completionType, plan.quest.targetId)
              );
            })
            .slice(0, QUEST_LIMIT);
          for (const { plan, id } of questItems) {
            const quest = plan.quest!;
            await tx.quest.create({
              data: {
                batchId: createdBatch.id,
                ownerId,
                briefItemId: id,
                title: quest.title,
                completionType: quest.completionType,
                targetId: quest.targetId,
                xpReward: quest.xpReward,
                status: "pending",
              },
            });
          }

          return tx.briefBatch.update({
            where: { id: createdBatch.id },
            data: { status: "ready", generatedAt: now },
            include: batchInclude,
          });
        },
        { isolationLevel: "Serializable" }
      );

      return presentBrief(batch);
    } catch (error) {
      if (isUniqueConflict(error)) {
        const winner = await this.findBatch(ownerId, localDate);
        if (winner?.status === "ready") return presentBrief(winner);
      }
      throw error;
    }
  }

  async getReadyForOwner(
    ownerId: string,
    now: Date
  ): Promise<DailyBrief | null> {
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { timeZone: true },
    });
    if (!owner) return null;
    const localDate = dateKeyToUtcDate(localDateKey(now, owner.timeZone));
    const batch = await this.findBatch(ownerId, localDate);
    return batch?.status === "ready" ? presentBrief(batch) : null;
  }

  private async loadOwner(ownerId: string): Promise<{ timeZone: string }> {
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { timeZone: true },
    });
    if (!owner) throw new Error("Brief owner not found");
    return owner;
  }

  private findBatch(
    ownerId: string,
    localDate: Date
  ): Promise<PersistedBriefBatch | null> {
    return this.prisma.briefBatch.findUnique({
      where: { ownerId_localDate: { ownerId, localDate } },
      include: batchInclude,
    }) as unknown as Promise<PersistedBriefBatch | null>;
  }

  private async loadContacts(ownerId: string): Promise<ContactCandidate[]> {
    const contacts: ContactCandidate[] = [];
    let cursor: string | undefined;

    while (true) {
      const page = (await this.prisma.contact.findMany({
        where: { ownerId, isDemo: false },
        orderBy: { id: "asc" },
        take: CONTACT_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          interactions: {
            orderBy: { occurredAt: "desc" },
            take: 1,
            select: { occurredAt: true },
          },
          tasks: {
            where: { status: "pending" },
            take: 1,
            select: { id: true },
          },
        },
      })) as unknown as ContactCandidate[];
      contacts.push(...page);

      if (page.length < CONTACT_PAGE_SIZE) return contacts;
      cursor = page.at(-1)!.id;
    }
  }

  private async loadExcludedContactIds(
    ownerId: string,
    contactIds: string[],
    now: Date
  ): Promise<Set<string>> {
    if (contactIds.length === 0) return new Set();
    const dismissCutoff = new Date(now.getTime() - DISMISS_COOLDOWN_MS);
    const excluded = new Set<string>();
    let cursor: string | undefined;

    while (true) {
      const page = await this.prisma.briefFeedback.findMany({
        where: {
          ownerId,
          briefItem: { contactId: { in: contactIds } },
          OR: [
            { action: "snooze", snoozedUntil: { gt: now } },
            { action: "dismiss", createdAt: { gte: dismissCutoff } },
          ],
        },
        select: {
          id: true,
          action: true,
          snoozedUntil: true,
          createdAt: true,
          briefItem: { select: { contactId: true } },
        },
        orderBy: { id: "asc" },
        take: FEEDBACK_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      for (const entry of page) {
        const contactId = entry.briefItem?.contactId;
        if (!contactId) continue;
        if (
          entry.action === "snooze" &&
          entry.snoozedUntil &&
          entry.snoozedUntil > now
        ) {
          excluded.add(contactId);
        }
        if (entry.action === "dismiss" && entry.createdAt >= dismissCutoff) {
          excluded.add(contactId);
        }
      }

      if (page.length < FEEDBACK_PAGE_SIZE) return excluded;
      cursor = page.at(-1)!.id;
    }
  }

  private async loadPendingQuestTargets(ownerId: string): Promise<Set<string>> {
    const targets = new Set<string>();
    let cursor: string | undefined;

    while (true) {
      const page = await this.prisma.quest.findMany({
        where: { ownerId, status: "pending" },
        select: { id: true, completionType: true, targetId: true },
        orderBy: { id: "asc" },
        take: QUEST_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const quest of page) {
        targets.add(questTargetKey(quest.completionType, quest.targetId));
      }

      if (page.length < QUEST_PAGE_SIZE) return targets;
      cursor = page.at(-1)!.id;
    }
  }

  private async loadPendingQuestTargetsInTransaction(
    tx: Prisma.TransactionClient,
    ownerId: string,
    plannedTargets: Set<string>
  ): Promise<Set<string>> {
    if (plannedTargets.size === 0) return new Set();
    const targets = new Set<string>();
    const targetFilters = [...plannedTargets].map((target) => {
      const separator = target.indexOf(":");
      return {
        completionType: target.slice(0, separator),
        targetId: target.slice(separator + 1),
      };
    });
    let cursor: string | undefined;

    while (true) {
      const page = await tx.quest.findMany({
        where: {
          ownerId,
          status: "pending",
          OR: targetFilters,
        },
        select: { id: true, completionType: true, targetId: true },
        orderBy: { id: "asc" },
        take: QUEST_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const quest of page) {
        targets.add(questTargetKey(quest.completionType, quest.targetId));
      }

      if (
        page.length < QUEST_PAGE_SIZE ||
        [...plannedTargets].every((target) => targets.has(target))
      ) {
        return targets;
      }
      cursor = page.at(-1)!.id;
    }
  }

  private rankPeople(
    contacts: ContactCandidate[],
    dates: ImportantDateCandidate[],
    now: Date
  ): RankedPerson[] {
    return contacts
      .map((contact) => {
        const importantDate = dates
          .filter((candidate) => candidate.contactId === contact.id)
          .sort(
            (left, right) =>
              left.daysAway - right.daysAway ||
              left.sourceId.localeCompare(right.sourceId)
          )[0];
        const health = assessRelationship({
          now,
          lastContactedAt: contact.lastContactedAt,
          preferredCadenceDays: contact.preferredCadenceDays,
        });
        const pendingTaskCount = contact.tasks.length;
        const score = rankRelationship({
          healthScore: health.score,
          importance: contact.importance,
          daysUntilImportantDate: importantDate?.daysAway,
          pendingTaskCount,
        });
        const lastInteractionAt = contact.interactions[0]?.occurredAt ?? null;
        const signals: RankedPerson["signals"] = [
          { code: "reason_code", value: health.reasonCode },
          { code: "importance", value: contact.importance },
          { code: "days_since_contact", value: health.daysSinceContact },
          { code: "days_overdue", value: health.daysOverdue },
          { code: "pending_task_count", value: pendingTaskCount },
          {
            code: "important_date_days",
            value: importantDate?.daysAway ?? null,
          },
        ];
        return {
          contact,
          contactName: contactName(contact),
          health,
          score,
          lastInteractionAt,
          reason: reasonFor(health, pendingTaskCount, importantDate),
          signals,
        };
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.contact.importance - left.contact.importance ||
          left.contact.id.localeCompare(right.contact.id)
      );
  }

  private planItems(
    people: RankedPerson[],
    dates: ImportantDateCandidate[],
    pendingQuestTargets: Set<string>
  ): PlannedItem[] {
    const plannedQuestTargets = new Set<string>();
    const personItems = people.map<PlannedItem>((person, index) => {
      const questTarget = questTargetKey("interaction", person.contact.id);
      const canCreateInteractionQuest =
        !pendingQuestTargets.has(questTarget) &&
        !plannedQuestTargets.has(questTarget);
      if (canCreateInteractionQuest) plannedQuestTargets.add(questTarget);

      return {
        kind: "person",
        contactId: person.contact.id,
        sourceType: "contact",
        sourceId: person.contact.id,
        rank: index + 1,
        score: person.score,
        title: person.contactName,
        reason: person.reason,
        evidence: {
          contactName: person.contactName,
          health: { score: person.health.score, band: person.health.band },
          lastInteractionAt: person.lastInteractionAt?.toISOString() ?? null,
          reasonCode: person.health.reasonCode,
          signals: person.signals,
        },
        ...(canCreateInteractionQuest
          ? {
              quest: {
                title: `Reach out to ${person.contactName}`,
                completionType: "interaction" as const,
                targetId: person.contact.id,
                xpReward: 15 as const,
              },
            }
          : {}),
      };
    });
    const dateItems = dates.map<PlannedItem>((candidate, index) => {
      const questTarget = questTargetKey("reminder", candidate.sourceId);
      const canCreateReminderQuest =
        candidate.sourceType === "reminder" &&
        !pendingQuestTargets.has(questTarget) &&
        !plannedQuestTargets.has(questTarget);
      if (canCreateReminderQuest) plannedQuestTargets.add(questTarget);
      return {
        kind: "date",
        contactId: candidate.contactId,
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        rank: index + 1,
        score: DATE_HORIZON_DAYS - candidate.daysAway,
        title: candidate.title,
        reason: candidate.reason,
        evidence: {
          contactName: candidate.contactName,
          date: candidate.dateKey,
          daysAway: candidate.daysAway,
        },
        ...(canCreateReminderQuest
          ? {
              quest: {
                title: `Complete reminder: ${candidate.title}`,
                completionType: "reminder" as const,
                targetId: candidate.sourceId,
                xpReward: 20 as const,
              },
            }
          : {}),
      };
    });
    return [...personItems, ...dateItems];
  }

  private planEventItems(events: PlannedEventRecommendation[]): PlannedItem[] {
    return events.slice(0, 3).map((event, index) => ({
      kind: "event",
      contactId: null,
      sourceType: "discovered_event",
      sourceId: event.sourceId,
      rank: index + 1,
      score: event.score,
      title: event.title,
      reason: event.reason,
      evidence: event.evidence as unknown as Record<string, unknown>,
      eventStartAt: event.startAt,
      eventEndAt: event.endAt,
      eventCity: event.city,
    }));
  }
}
