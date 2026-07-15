import { Injectable } from "@nestjs/common";
import { getGregorianDateForCelebration } from "../celebrations/celebrations.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  assertTimeZone,
  dateKeyToUtcDate,
  daysFromLocalDate,
  localDateKey,
} from "./brief-time.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ImportantDateCandidate {
  sourceType: "birthday" | "anniversary" | "celebration" | "reminder";
  sourceId: string;
  contactId: string;
  contactName: string;
  title: string;
  dateKey: string;
  daysAway: number;
  reason: string;
}

interface CandidateWithOccasion {
  candidate: ImportantDateCandidate;
  occasion: string;
}

interface GeneratedCelebrationOccurrence {
  occasion: string;
  dateKey: string;
}

const typePriority: Record<ImportantDateCandidate["sourceType"], number> = {
  birthday: 0,
  anniversary: 1,
  celebration: 2,
  reminder: 3,
};

function contactName(contact: {
  firstName: string;
  lastName: string | null;
}): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}

function monthAndDay(date: Date): { month: number; day: number } {
  return { month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

function utcDateKey(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetweenDateKeys(from: string, to: string): number {
  return (
    (dateKeyToUtcDate(to).getTime() - dateKeyToUtcDate(from).getTime()) / DAY_MS
  );
}

function normalizeOccasion(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function celebrationReminderKey(
  contactId: string,
  dateKey: string,
  title: string
): string {
  return `${contactId}\u0000${dateKey}\u0000${title}`;
}

function reasonFor(label: string, daysAway: number): string {
  return daysAway === 0
    ? `${label} is today`
    : `${label} is in ${daysAway} days`;
}

function inHorizon(daysAway: number, horizonDays: number): boolean {
  return daysAway >= 0 && daysAway <= horizonDays;
}

@Injectable()
export class ImportantDatesService {
  constructor(private readonly prisma: PrismaService) {}

  async collect(
    ownerId: string,
    now: Date,
    timeZone: string,
    horizonDays: number
  ): Promise<ImportantDateCandidate[]> {
    assertTimeZone(timeZone);
    if (!Number.isInteger(horizonDays) || horizonDays < 0) {
      throw new Error("Invalid important-date horizon");
    }

    const reminderWindowEnd = new Date(
      now.getTime() + (horizonDays + 2) * DAY_MS
    );
    const [contacts, contactCelebrations, reminders] = await Promise.all([
      this.prisma.contact.findMany({
        where: {
          ownerId,
          isDemo: false,
          OR: [{ birthday: { not: null } }, { anniversary: { not: null } }],
        },
        select: {
          id: true,
          ownerId: true,
          isDemo: true,
          firstName: true,
          lastName: true,
          birthday: true,
          anniversary: true,
        },
      }),
      this.prisma.contactCelebration.findMany({
        where: {
          ownerId,
          status: "active",
          shouldRemind: true,
          contact: { ownerId, isDemo: false },
        },
        select: {
          id: true,
          ownerId: true,
          status: true,
          shouldRemind: true,
          customDate: true,
          contact: {
            select: {
              id: true,
              ownerId: true,
              isDemo: true,
              firstName: true,
              lastName: true,
            },
          },
          celebration: {
            select: {
              id: true,
              name: true,
              date: true,
              fullDate: true,
              calendarType: true,
            },
          },
        },
      }),
      this.prisma.reminder.findMany({
        where: {
          ownerId,
          status: "pending",
          scheduledAt: { gte: now, lte: reminderWindowEnd },
          contact: { ownerId, isDemo: false },
        },
        select: {
          id: true,
          ownerId: true,
          status: true,
          type: true,
          title: true,
          description: true,
          scheduledAt: true,
          contact: {
            select: {
              id: true,
              ownerId: true,
              isDemo: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
    ]);

    const candidates: CandidateWithOccasion[] = [];
    const generatedCelebrationOccurrences = new Map<
      string,
      GeneratedCelebrationOccurrence
    >();

    for (const contact of contacts) {
      if (contact.ownerId !== ownerId || contact.isDemo) continue;
      const name = contactName(contact);

      for (const sourceType of ["birthday", "anniversary"] as const) {
        const sourceDate = contact[sourceType];
        if (!sourceDate) continue;
        const { month, day } = monthAndDay(sourceDate);
        const occurrence = daysFromLocalDate(now, timeZone, month, day);
        if (!inHorizon(occurrence.daysAway, horizonDays)) continue;

        const label = `${name}'s ${sourceType}`;
        candidates.push({
          occasion: sourceType,
          candidate: {
            sourceType,
            sourceId: contact.id,
            contactId: contact.id,
            contactName: name,
            title: label,
            ...occurrence,
            reason: reasonFor(label, occurrence.daysAway),
          },
        });
      }
    }

    const currentDateKey = localDateKey(now, timeZone);
    const currentYear = Number(currentDateKey.slice(0, 4));

    for (const attached of contactCelebrations) {
      if (
        attached.ownerId !== ownerId ||
        attached.status !== "active" ||
        !attached.shouldRemind ||
        attached.contact.ownerId !== ownerId ||
        attached.contact.isDemo
      ) {
        continue;
      }

      let occurrence: { dateKey: string; daysAway: number } | null = null;
      if (attached.customDate) {
        const { month, day } = monthAndDay(attached.customDate);
        occurrence = daysFromLocalDate(now, timeZone, month, day);
      } else {
        const lastYear = attached.celebration.fullDate
          ? currentYear
          : currentYear + 8;
        for (
          let targetYear = currentYear;
          targetYear <= lastYear;
          targetYear += 1
        ) {
          const date = getGregorianDateForCelebration(
            attached.celebration,
            targetYear
          );
          if (!date) continue;
          const dateKey = utcDateKey(date);
          const daysAway = daysBetweenDateKeys(currentDateKey, dateKey);
          if (daysAway >= 0) {
            occurrence = { dateKey, daysAway };
            break;
          }
        }
      }

      if (!occurrence || !inHorizon(occurrence.daysAway, horizonDays)) continue;
      const name = contactName(attached.contact);
      const label = `${name}: ${attached.celebration.name}`;
      const occasion = normalizeOccasion(attached.celebration.name);
      generatedCelebrationOccurrences.set(
        celebrationReminderKey(
          attached.contact.id,
          occurrence.dateKey,
          `${attached.contact.firstName} - ${attached.celebration.name}`
        ),
        { occasion, dateKey: occurrence.dateKey }
      );
      candidates.push({
        occasion,
        candidate: {
          sourceType: "celebration",
          sourceId: attached.id,
          contactId: attached.contact.id,
          contactName: name,
          title: label,
          ...occurrence,
          reason: reasonFor(label, occurrence.daysAway),
        },
      });
    }

    for (const reminder of reminders) {
      if (
        reminder.ownerId !== ownerId ||
        reminder.status !== "pending" ||
        reminder.contact.ownerId !== ownerId ||
        reminder.contact.isDemo ||
        reminder.scheduledAt < now
      ) {
        continue;
      }

      const localReminderDateKey = localDateKey(reminder.scheduledAt, timeZone);
      const generatedOccurrence =
        generatedCelebrationOccurrences.get(
          celebrationReminderKey(
            reminder.contact.id,
            localReminderDateKey,
            reminder.title
          )
        ) ??
        generatedCelebrationOccurrences.get(
          celebrationReminderKey(
            reminder.contact.id,
            utcDateKey(reminder.scheduledAt),
            reminder.title
          )
        );
      const dateKey = generatedOccurrence?.dateKey ?? localReminderDateKey;
      const daysAway = daysBetweenDateKeys(currentDateKey, dateKey);
      if (!inHorizon(daysAway, horizonDays)) continue;
      const name = contactName(reminder.contact);
      const occasion =
        generatedOccurrence?.occasion ??
        (["birthday", "anniversary"].includes(reminder.type)
          ? reminder.type
          : normalizeOccasion(reminder.title));
      candidates.push({
        occasion,
        candidate: {
          sourceType: "reminder",
          sourceId: reminder.id,
          contactId: reminder.contact.id,
          contactName: name,
          title: reminder.title,
          dateKey,
          daysAway,
          reason: reminder.description ?? reasonFor(reminder.title, daysAway),
        },
      });
    }

    candidates.sort((left, right) => {
      const days = left.candidate.daysAway - right.candidate.daysAway;
      if (days !== 0) return days;
      const type =
        typePriority[left.candidate.sourceType] -
        typePriority[right.candidate.sourceType];
      if (type !== 0) return type;
      return left.candidate.sourceId.localeCompare(right.candidate.sourceId);
    });

    const seen = new Set<string>();
    return candidates.flatMap(({ candidate, occasion }) => {
      const key = `${candidate.contactId}\u0000${candidate.dateKey}\u0000${occasion}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [candidate];
    });
  }
}
