/**
 * AgentRemindersService -- AI agent-facing reminder tools.
 *
 * Provides structured, low-level tool implementations for:
 * - suggestContacts: returns contacts needing attention, sorted by urgency
 * - scheduleReminder: creates a reminder directly from agent intent
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
// ========== Local type definitions (mirrors @socos/agent-core/tools/tool-schema.ts) ==========

interface SuggestContactsInput {
  reason?: 'stale' | 'birthday' | 'followup' | 'new';
  limit?: number;
}

interface SuggestedContact {
  id: string;
  name: string;
  lastContactedAt: string | null;
  reason: string;
  priority: 'high' | 'medium' | 'low';
  upcomingBirthday: boolean;
  relationshipScore: number;
  daysSinceContact: number | null;
}


interface SuggestContactsOutput {
  contacts: SuggestedContact[];
}


interface ScheduleReminderInput {
  contactId: string;
  type: 'birthday' | 'followup' | 'custom';
  scheduledAt: string;
  message?: string;
}

interface ScheduleReminderOutput {
  reminderId: string;
  success: boolean;
}


@Injectable()
export class AgentRemindersService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  // ========== Tool: suggestContacts ==========

  async suggestContacts(
    userId: string,
    input: SuggestContactsInput,
  ): Promise<SuggestContactsOutput> {
    const limit = input.limit ?? 5;
    const reason = input.reason ?? 'all';

    const contacts = await this.prisma.contact.findMany({
      where: { ownerId: userId, isDemo: false },
      include: {
        _count: { select: { interactions: true } },
      },
    });

    const now = new Date();

    const scored = contacts.map((c) => {
      const lastContactedAt = c.lastContactedAt ?? null;
      const daysSinceContact = lastContactedAt
        ? Math.floor((now.getTime() - lastContactedAt.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      // Stale score: 0-40 pts
      const staleScore =
        daysSinceContact !== null
          ? Math.min(40, (daysSinceContact / 14) * 40)
          : 40;

      // Birthday proximity score: 0-30 pts
      let birthdayScore = 0;
      if (c.birthday) {
        const bdayThisYear = new Date(
          now.getFullYear(),
          c.birthday.getMonth(),
          c.birthday.getDate(),
        );
        if (bdayThisYear < now) bdayThisYear.setFullYear(bdayThisYear.getFullYear() + 1);
        const daysUntilBday = Math.floor(
          (bdayThisYear.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        if (daysUntilBday <= 30) birthdayScore = Math.max(0, 30 - daysUntilBday);
      }

      // Relationship score: 0-30 pts
      const relationshipScorePct = Math.round((c.relationshipScore ?? 50) * 0.3);

      const totalScore = staleScore + birthdayScore + relationshipScorePct;

      // Priority band
      let priority: 'high' | 'medium' | 'low' = 'medium';
      if (daysSinceContact === null || daysSinceContact > 60 || (c.relationshipScore ?? 50) < 30) {
        priority = 'high';
      } else if (daysSinceContact <= 14 && (c.relationshipScore ?? 50) >= 60) {
        priority = 'low';
      }

      // Reason string
      const name = c.firstName;
      let reasonStr = '';
      if (daysSinceContact === null) {
        reasonStr = `You have never contacted ${name}. A first hello could start something great!`;
      } else if (daysSinceContact > 60) {
        reasonStr = `You have not contacted ${name} in ${daysSinceContact} days. Time for a reconnection!`;
      } else if (daysSinceContact > 30) {
        reasonStr = `It has been ${daysSinceContact} days since your last connection with ${name}. A check-in is due.`;
      } else {
        reasonStr = `Regular touchpoints help maintain the relationship with ${name}.`;
      }

      // Upcoming birthday flag
      const upcomingBirthday = (() => {
        if (!c.birthday) return false;
        const bdayThisYear = new Date(
          now.getFullYear(),
          c.birthday.getMonth(),
          c.birthday.getDate(),
        );
        if (bdayThisYear < now) bdayThisYear.setFullYear(bdayThisYear.getFullYear() + 1);
        const daysUntilBday = Math.floor(
          (bdayThisYear.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
        return daysUntilBday <= 30;
      })();

      return {
        id: c.id,
        name: `${c.firstName}${c.lastName ? ` ${c.lastName}` : ''}`,
        lastContactedAt: c.lastContactedAt?.toISOString() ?? null,
        reason: reasonStr,
        priority,
        upcomingBirthday,
        relationshipScore: c.relationshipScore ?? 50,
        daysSinceContact,
        totalScore,
      };
    });

    const filtered =
      reason === 'all'
        ? scored
        : reason === 'stale'
          ? scored.filter((c) => c.daysSinceContact > 14)
          : reason === 'birthday'
            ? scored.filter((c) => c.upcomingBirthday)
            : reason === 'new'
              ? scored.filter((c) => c.daysSinceContact === null)
              : scored;

    const contactsResult: SuggestedContact[] = filtered
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, limit)
      .map(({ totalScore: _s, ...rest }) => rest);

    return { contacts: contactsResult };
  }

  // ========== Tool: scheduleReminder ==========

  async scheduleReminder(
    userId: string,
    input: ScheduleReminderInput,
  ): Promise<ScheduleReminderOutput> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: input.contactId, ownerId: userId },
    });

    if (!contact || contact.isDemo) {
      return { reminderId: '', success: false };
    }

    const reminder = await this.prisma.reminder.create({
      data: {
        contactId: input.contactId,
        ownerId: userId,
        type: input.type,
        title:
          input.type === 'birthday'
            ? `${contact.firstName}'s birthday`
            : input.type === 'followup'
              ? `Follow up with ${contact.firstName}`
              : input.message ?? `Reminder for ${contact.firstName}`,
        description: input.message,
        scheduledAt: new Date(input.scheduledAt),
        repeatInterval: input.type === 'birthday' ? 'yearly' : undefined,
        isRecurring: input.type === 'birthday',
      },
    });

    if (['birthday', 'followup'].includes(input.type)) {
      const name = `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`;
      this.notificationsService
        .sendReminderNotification(userId, {
          contactName: name,
          type: input.type as 'birthday' | 'followup',
          date: new Date(input.scheduledAt).toLocaleDateString(),
        })
        .catch((err) =>
          console.error('Failed to send reminder notification:', err),
        );
    }

    return { reminderId: reminder.id, success: true };
  }
}
