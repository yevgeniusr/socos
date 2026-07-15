import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { CreateReminderDto, UpdateReminderDto, ReminderQueryDto } from './reminders.dto.js';

@Injectable()
export class RemindersService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
  ) {}

  async create(userId: string, dto: CreateReminderDto) {
    // Verify contact belongs to user
    const contact = await this.prisma.contact.findFirst({
      where: { id: dto.contactId, ownerId: userId },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const reminder = await this.prisma.reminder.create({
      data: {
        contactId: dto.contactId,
        ownerId: userId,
        type: dto.type,
        title: dto.title,
        description: dto.description,
        scheduledAt: new Date(dto.scheduledAt),
        repeatInterval: dto.repeatInterval,
        isRecurring: dto.isRecurring || false,
      },
      include: {
        contact: {
          select: { id: true, firstName: true, lastName: true, photo: true },
        },
      },
    });

    // Send notification for birthday, anniversary, or followup reminders
    if (!contact.isDemo && ['birthday', 'anniversary', 'followup'].includes(dto.type)) {
      const contactName = `${reminder.contact.firstName}${reminder.contact.lastName ? ` ${reminder.contact.lastName}` : ''}`;
      this.notificationsService.sendReminderNotification(userId, {
        contactName,
        type: dto.type as 'birthday' | 'anniversary' | 'followup',
        date: new Date(dto.scheduledAt).toLocaleDateString(),
      }).catch(err => console.error('Failed to send reminder notification:', err));
    }

    return reminder;
  }

  async findAll(userId: string, query: ReminderQueryDto) {
    const where: any = { ownerId: userId };

    if (query.contactId) {
      where.contactId = query.contactId;
    }

    if (query.type) {
      where.type = query.type;
    }

    if (query.status) {
      where.status = query.status;
    }

    const [reminders, total] = await Promise.all([
      this.prisma.reminder.findMany({
        where,
        skip: query.offset || 0,
        take: query.limit || 20,
        orderBy: { scheduledAt: 'asc' },
        include: {
          contact: {
            select: { id: true, firstName: true, lastName: true, photo: true },
          },
        },
      }),
      this.prisma.reminder.count({ where }),
    ]);

    return {
      reminders,
      total,
      offset: query.offset || 0,
      limit: query.limit || 20,
    };
  }

  async getUpcoming(userId: string) {
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    const endOfWeek = new Date(now);
    endOfWeek.setDate(endOfWeek.getDate() + 7);

    const [reminders, stats] = await Promise.all([
      this.prisma.reminder.findMany({
        where: {
          ownerId: userId,
          status: 'pending',
          scheduledAt: { gte: now },
          contact: { isDemo: false },
        },
        take: 20,
        orderBy: { scheduledAt: 'asc' },
        include: {
          contact: {
            select: { id: true, firstName: true, lastName: true, photo: true },
          },
        },
      }),
      this.prisma.reminder.groupBy({
        by: ['status'],
        where: {
          ownerId: userId,
          scheduledAt: { gte: now, lte: endOfToday },
          contact: { isDemo: false },
        },
        _count: true,
      }),
    ]);

    const overdueCount = await this.prisma.reminder.count({
      where: {
        ownerId: userId,
        status: 'pending',
        scheduledAt: { lt: now },
        contact: { isDemo: false },
      },
    });

    const todayCount = await this.prisma.reminder.count({
      where: {
        ownerId: userId,
        status: 'pending',
        scheduledAt: { gte: now, lte: endOfToday },
        contact: { isDemo: false },
      },
    });

    const thisWeekCount = await this.prisma.reminder.count({
      where: {
        ownerId: userId,
        status: 'pending',
        scheduledAt: { gte: now, lte: endOfWeek },
        contact: { isDemo: false },
      },
    });

    return {
      reminders,
      stats: {
        today: todayCount,
        thisWeek: thisWeekCount,
        overdue: overdueCount,
      },
    };
  }

  async update(userId: string, reminderId: string, dto: UpdateReminderDto) {
    const reminder = await this.prisma.reminder.findFirst({
      where: { id: reminderId, ownerId: userId },
    });

    if (!reminder) {
      throw new NotFoundException('Reminder not found');
    }

    const updateData: any = { ...dto };
    
    if (dto.scheduledAt) {
      updateData.scheduledAt = new Date(dto.scheduledAt);
    }

    const updated = await this.prisma.reminder.update({
      where: { id: reminderId },
      data: updateData,
      include: {
        contact: {
          select: { id: true, firstName: true, lastName: true, photo: true },
        },
      },
    });

    return updated;
  }

  async complete(userId: string, reminderId: string) {
    const reminder = await this.prisma.reminder.findFirst({
      where: { id: reminderId, ownerId: userId },
    });

    if (!reminder) {
      throw new NotFoundException('Reminder not found');
    }

    // If recurring, create next reminder
    if (reminder.isRecurring && reminder.repeatInterval) {
      const nextDate = this.calculateNextDate(
        new Date(reminder.scheduledAt),
        reminder.repeatInterval,
      );

      await this.prisma.reminder.create({
        data: {
          contactId: reminder.contactId,
          ownerId: userId,
          type: reminder.type,
          title: reminder.title,
          description: reminder.description,
          scheduledAt: nextDate,
          repeatInterval: reminder.repeatInterval,
          isRecurring: true,
        },
      });
    }

    const updated = await this.prisma.reminder.update({
      where: { id: reminderId },
      data: {
        status: 'completed',
        completedAt: new Date(),
      },
      include: {
        contact: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            photo: true,
            isDemo: true,
          },
        },
      },
    });

    // Send celebration/achievement-style notification on completion
    if (
      !updated.contact.isDemo &&
      ['birthday', 'anniversary', 'followup'].includes(reminder.type)
    ) {
      const contactName = `${updated.contact.firstName}${updated.contact.lastName ? ` ${updated.contact.lastName}` : ''}`;
      this.notificationsService.sendReminderNotification(userId, {
        contactName,
        type: reminder.type as 'birthday' | 'anniversary' | 'followup',
        message: 'Great job! You completed this reminder.',
      }).catch(err => console.error('Failed to send completion notification:', err));
    }

    return updated;
  }

  async delete(userId: string, reminderId: string) {
    const reminder = await this.prisma.reminder.findFirst({
      where: { id: reminderId, ownerId: userId },
    });

    if (!reminder) {
      throw new NotFoundException('Reminder not found');
    }

    await this.prisma.reminder.delete({
      where: { id: reminderId },
    });

    return { success: true };
  }

  private calculateNextDate(currentDate: Date, interval: string): Date {
    const next = new Date(currentDate);
    
    switch (interval) {
      case 'daily':
        next.setDate(next.getDate() + 1);
        break;
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
      case 'yearly':
        next.setFullYear(next.getFullYear() + 1);
        break;
    }

    return next;
  }
}
