/**
 * Reminder Agent
 *
 * Handles:
 * - Birthday reminders
 * - Anniversary reminders
 * - Follow-up reminders
 * - Stale contact alerts
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  AgentContext,
  AgentResult,
  ReminderRecommendation,
} from '../agents/types.js';

@Injectable()
export class ReminderAgent {
  constructor(private prisma: PrismaService) {}

  /**
   * Get all upcoming reminders for a user
   */
  async getUpcomingReminders(
    ctx: AgentContext,
    options: { daysAhead?: number; types?: string[] } = {},
  ): Promise<AgentResult<ReminderRecommendation[]>> {
    const { daysAhead = 14, types = ['birthday', 'anniversary', 'followup', 'stale'] } =
      options;

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + daysAhead);

    try {
      const reminders = await this.prisma.reminder.findMany({
        where: {
          ownerId: ctx.userId,
          status: 'pending',
          scheduledAt: {
            gte: new Date(),
            lte: endDate,
          },
          contact: { isDemo: false },
          ...(types.length > 0 ? { type: { in: types } } : {}),
        },
        include: {
          contact: {
            select: { id: true, firstName: true, lastName: true, photo: true },
          },
        },
        orderBy: { scheduledAt: 'asc' },
      });

      const recommendations: ReminderRecommendation[] = reminders.map((r) => ({
        contactId: r.contactId,
        contactName: `${r.contact.firstName}${r.contact.lastName ? ` ${r.contact.lastName}` : ''}`,
        reminderType: r.type as any,
        title: r.title,
        scheduledAt: r.scheduledAt,
        isRecurring: r.isRecurring,
      }));

      return {
        success: true,
        agent: 'reminder' as any,
        data: recommendations,
        executedAt: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        agent: 'reminder' as any,
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt: new Date(),
      };
    }
  }

  /**
   * Auto-generate reminders for contacts with upcoming birthdays
   */
  async suggestBirthdayReminders(
    ctx: AgentContext,
    options: { daysAhead?: number } = {},
  ): Promise<AgentResult<ReminderRecommendation[]>> {
    const { daysAhead = 30 } = options;

    try {
      const now = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + daysAhead);

      // Find contacts with birthdays in the next N days
      const contacts = await this.prisma.contact.findMany({
        where: {
          ownerId: ctx.userId,
          isDemo: false,
          birthday: { not: null },
        },
      });

      const recommendations: ReminderRecommendation[] = [];

      for (const contact of contacts) {
        if (!contact.birthday) continue;

        const birthdayThisYear = new Date(now.getFullYear(), contact.birthday.getMonth(), contact.birthday.getDate());
        if (birthdayThisYear < now) {
          birthdayThisYear.setFullYear(birthdayThisYear.getFullYear() + 1);
        }

        if (birthdayThisYear <= endDate) {
          // Check if there's already a reminder for this birthday
          const existingReminder = await this.prisma.reminder.findFirst({
            where: {
              contactId: contact.id,
              type: 'birthday',
              scheduledAt: birthdayThisYear,
            },
          });

          if (!existingReminder) {
            recommendations.push({
              contactId: contact.id,
              contactName: `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`,
              reminderType: 'birthday',
              title: `${contact.firstName}'s birthday`,
              scheduledAt: birthdayThisYear,
              isRecurring: true,
            });
          }
        }
      }

      return {
        success: true,
        agent: 'reminder' as any,
        data: recommendations,
        executedAt: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        agent: 'reminder' as any,
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt: new Date(),
      };
    }
  }

  /**
   * Suggest reminders for stale contacts (haven't been contacted in a while)
   */
  async suggestStaleContactReminders(
    ctx: AgentContext,
    options: { staleDays?: number; limit?: number } = {},
  ): Promise<AgentResult<ReminderRecommendation[]>> {
    const { staleDays = 30, limit = 10 } = options;

    try {
      const staleDate = new Date();
      staleDate.setDate(staleDate.getDate() - staleDays);

      const contacts = await this.prisma.contact.findMany({
        where: {
          ownerId: ctx.userId,
          isDemo: false,
          OR: [
            { lastContactedAt: { lt: staleDate } },
            {
              lastContactedAt: null,
              createdAt: { lt: staleDate },
            },
          ],
        },
        include: {
          _count: {
            select: { interactions: true },
          },
        },
        orderBy: { lastContactedAt: 'asc' },
        take: limit,
      });

      const recommendations: ReminderRecommendation[] = contacts
        .filter((c) => c._count.interactions > 0) // Only contacts with prior interactions
        .map((contact) => {
          const daysSince = contact.lastContactedAt
            ? Math.floor(
                (Date.now() - contact.lastContactedAt.getTime()) /
                  (1000 * 60 * 60 * 24),
              )
            : Math.floor(
                (Date.now() - contact.createdAt.getTime()) /
                  (1000 * 60 * 60 * 24),
              );

          const scheduledAt = new Date();
          scheduledAt.setDate(scheduledAt.getDate() + 7); // Schedule 1 week from now

          return {
            contactId: contact.id,
            contactName: `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`,
            reminderType: 'stale' as any,
            title: `Check in with ${contact.firstName}`,
            scheduledAt,
            isRecurring: false,
          };
        });

      return {
        success: true,
        agent: 'reminder' as any,
        data: recommendations,
        executedAt: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        agent: 'reminder' as any,
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt: new Date(),
      };
    }
  }

  /**
   * Auto-create reminders from celebration dates
   */
  async syncCelebrationReminders(
    ctx: AgentContext,
  ): Promise<AgentResult<{ created: number; existing: number }>> {
    try {
      const now = new Date();
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      const contactCelebrations = await this.prisma.contactCelebration.findMany({
        where: {
          ownerId: ctx.userId,
          status: 'active',
          shouldRemind: true,
          contact: { ownerId: ctx.userId, isDemo: false },
          celebration: {
            pack: {
              OR: [{ ownerId: null }, { ownerId: ctx.userId }],
            },
          },
        },
        include: {
          contact: true,
          celebration: {
            include: { pack: true },
          },
        },
      });

      let created = 0;
      let existing = 0;

      for (const cc of contactCelebrations) {
        if (!cc.contact.birthday && cc.celebration.calendarType === 'lunar') {
          // Handle lunar calendar dates (simplified - would need lunar library)
          continue;
        }

        const celebrationDate = this.calculateCelebrationDate(cc, now);

        if (celebrationDate >= now && celebrationDate <= thirtyDaysFromNow) {
          // Check if reminder exists
          const existingReminder = await this.prisma.reminder.findFirst({
            where: {
              contactId: cc.contactId,
              ownerId: ctx.userId,
              type: 'birthday', // Simplified - could be more specific
              scheduledAt: celebrationDate,
            },
          });

          if (!existingReminder) {
            await this.prisma.reminder.create({
              data: {
                contactId: cc.contactId,
                ownerId: ctx.userId,
                type: 'birthday',
                title: `${cc.contact.firstName} - ${cc.celebration.name}`,
                description: cc.celebration.description || undefined,
                scheduledAt: celebrationDate,
                isRecurring: !cc.celebration.fullDate,
                repeatInterval: cc.celebration.fullDate ? undefined : 'yearly',
              },
            });
            created++;
          } else {
            existing++;
          }
        }
      }

      return {
        success: true,
        agent: 'reminder' as any,
        data: { created, existing },
        executedAt: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        agent: 'reminder' as any,
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt: new Date(),
      };
    }
  }

  private calculateCelebrationDate(
    cc: {
      customDate?: Date | null;
      celebration: {
        date: string;
        fullDate?: Date | null;
        calendarType: string;
      };
    },
    referenceDate: Date,
  ): Date {
    // If there's a custom date override, use it
    if (cc.customDate) {
      return cc.customDate;
    }

    // If it's a full date (one-time event), use it
    if (cc.celebration.fullDate) {
      return cc.celebration.fullDate;
    }

    // Otherwise, it's a recurring MM-DD date
    const [month, day] = cc.celebration.date.split('-').map(Number);
    const referenceYear = referenceDate.getUTCFullYear();
    const referenceDateCarrier = new Date(
      Date.UTC(
        referenceYear,
        referenceDate.getUTCMonth(),
        referenceDate.getUTCDate(),
      ),
    );
    let date = new Date(Date.UTC(referenceYear, month - 1, day));

    // If the date has passed this year, it will be next year
    if (date < referenceDateCarrier) {
      date = new Date(Date.UTC(referenceYear + 1, month - 1, day));
    }

    return date;
  }
}
