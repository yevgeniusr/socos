import { Injectable, NotFoundException } from "@nestjs/common";
import { BriefGeneratorService } from "../briefs/brief-generator.service.js";
import { assessRelationship } from "../briefs/relationship-health.js";
import { ImportantDatesService } from "../briefs/important-dates.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RemindersService } from "../reminders/reminders.service.js";

@Injectable()
export class AgentReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly briefs: BriefGeneratorService,
    private readonly dates: ImportantDatesService,
    private readonly reminders: RemindersService
  ) {}

  async briefToday(ownerId: string, now: Date) {
    const brief = await this.briefs.getReadyForOwner(ownerId, now);
    return brief ?? { status: "BRIEF_NOT_READY" as const };
  }

  async contactsSearch(ownerId: string, query: string, limit: number) {
    const contacts = await this.prisma.contact.findMany({
      where: {
        ownerId,
        isDemo: false,
        OR: [
          { firstName: { contains: query, mode: "insensitive" } },
          { lastName: { contains: query, mode: "insensitive" } },
          { nickname: { contains: query, mode: "insensitive" } },
          { company: { contains: query, mode: "insensitive" } },
        ],
      },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        company: true,
        jobTitle: true,
        lastContactedAt: true,
      },
    });
    return {
      contacts: contacts.map((contact) => ({
        id: contact.id,
        name: contactName(contact),
        company: contact.company,
        jobTitle: contact.jobTitle,
        lastContactedAt: contact.lastContactedAt?.toISOString() ?? null,
      })),
    };
  }

  async relationshipHealth(ownerId: string, contactId: string, now: Date) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, ownerId, isDemo: false },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        preferredCadenceDays: true,
        lastContactedAt: true,
      },
    });
    if (!contact) throw new NotFoundException("Contact not found");
    return {
      contact: { id: contact.id, name: contactName(contact) },
      health: assessRelationship({
        now,
        lastContactedAt: contact.lastContactedAt,
        preferredCadenceDays: contact.preferredCadenceDays,
      }),
      preferredCadenceDays: contact.preferredCadenceDays,
      lastContactedAt: contact.lastContactedAt?.toISOString() ?? null,
    };
  }

  async importantDates(ownerId: string, horizonDays: number, now: Date) {
    const owner = await this.prisma.user.findUnique({
      where: { id: ownerId },
      select: { timeZone: true },
    });
    if (!owner) throw new NotFoundException("Owner not found");
    const dates = await this.dates.collect(
      ownerId,
      now,
      owner.timeZone,
      horizonDays
    );
    return {
      dates: dates.map((date) => ({
        type: date.sourceType,
        contact: { id: date.contactId, name: date.contactName },
        title: date.title,
        date: date.dateKey,
        daysAway: date.daysAway,
        reason: date.reason,
      })),
    };
  }

  async remindersList(ownerId: string, limit: number) {
    const result = await this.reminders.getUpcoming(ownerId);
    return {
      reminders: result.reminders.slice(0, limit).map((reminder) => ({
        id: reminder.id,
        type: reminder.type,
        scheduledAt: reminder.scheduledAt.toISOString(),
        contact: {
          id: reminder.contact.id,
          name: contactName(reminder.contact),
        },
      })),
      stats: result.stats,
    };
  }
}

function contactName(contact: {
  firstName: string;
  lastName: string | null;
}): string {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}
