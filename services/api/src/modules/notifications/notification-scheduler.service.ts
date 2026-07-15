/**
 * Notification Scheduler Service
 *
 * Runs periodic cron jobs to:
 * 1. Check for due reminders → send email/SMS notifications (every 5 min)
 * 2. Mark overdue reminders (every 30 min)
 *
 * Uses @nestjs/schedule for cron-based execution.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from './notifications.service.js';

@Injectable()
export class NotificationSchedulerService {
  private readonly logger = new Logger(NotificationSchedulerService.name);

  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Check for due reminders every 5 minutes and send notifications.
   * Reminders are considered "due" if they were scheduled within the last 5 minutes
   * and are still in "pending" status.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'check-due-reminders' })
  async handleDueReminders(): Promise<void> {
    this.logger.log('🔔 [Scheduler] Checking for due reminders...');

    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    try {
      const dueReminders = await this.prisma.reminder.findMany({
        where: {
          status: 'pending',
          scheduledAt: {
            gte: fiveMinutesAgo,
            lte: now,
          },
          contact: { isDemo: false },
        },
        include: {
          contact: {
            select: { id: true, firstName: true, lastName: true },
          },
          owner: {
            select: { id: true, email: true, name: true },
          },
        },
      });

      if (dueReminders.length === 0) {
        this.logger.debug('No due reminders found.');
        return;
      }

      this.logger.log(`Found ${dueReminders.length} due reminder(s)`);

      const results = await Promise.allSettled(
        dueReminders.map(async (reminder) => {
          if (!['birthday', 'anniversary', 'followup'].includes(reminder.type)) {
            return { reminderId: reminder.id, sent: false, reason: 'unsupported_type' };
          }

          const contactName = `${reminder.contact.firstName}${reminder.contact.lastName ? ` ${reminder.contact.lastName}` : ''}`;

          try {
            await this.notificationsService.sendReminderNotification(reminder.ownerId, {
              contactName,
              type: reminder.type as 'birthday' | 'anniversary' | 'followup',
              date: reminder.scheduledAt.toLocaleDateString(),
              message: reminder.description || undefined,
            });

            this.logger.log(`✅ Reminder notification sent: ${reminder.id}`);
            return { reminderId: reminder.id, sent: true };
          } catch (error) {
            this.logger.error(`❌ Failed to send reminder notification ${reminder.id}`);
            return { reminderId: reminder.id, sent: false, error: String(error) };
          }
        }),
      );

      const sent = results.filter(
        (result) => result.status === 'fulfilled' && result.value.sent === true,
      ).length;
      const failed = results.length - sent;
      this.logger.log(`📊 Reminder batch complete: ${sent} sent, ${failed} failed`);
    } catch {
      this.logger.error('❌ Error checking due reminders');
    }
  }

  /**
   * Mark overdue reminders as "overdue" status (for UI differentiation).
   * Runs every 30 minutes.
   */
  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'mark-overdue-reminders' })
  async markOverdueReminders(): Promise<void> {
    this.logger.debug('[Scheduler] Marking overdue reminders...');

    try {
      const result = await this.prisma.reminder.updateMany({
        where: {
          status: 'pending',
          scheduledAt: { lt: new Date() },
          contact: { isDemo: false },
        },
        data: {
          status: 'overdue',
        },
      });

      if (result.count > 0) {
        this.logger.log(`⚠️  Marked ${result.count} reminder(s) as overdue`);
      }
    } catch (error) {
      this.logger.error(`❌ Error marking overdue reminders: ${error}`);
    }
  }
}
