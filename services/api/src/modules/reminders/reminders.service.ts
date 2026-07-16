import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { HumanIdempotencyService } from '../../common/human-idempotency.service.js';
import {
  CreateReminderDto,
  ReminderQueryDto,
  ReminderType,
  RepeatInterval,
  UpdateReminderDto,
} from './reminders.dto.js';

export interface AgentReminderInput {
  contactId: string;
  type: ReminderType;
  title: string;
  description?: string;
  scheduledAt: string;
  repeatInterval?: RepeatInterval;
  isRecurring?: boolean;
}

export interface AgentReminderResult {
  reminderId: string;
  contactId: string;
  type: string;
  title: string;
  scheduledAt: Date;
  status: string;
}

@Injectable()
export class RemindersService {
  constructor(
    private prisma: PrismaService,
    private notificationsService: NotificationsService,
    @Optional() private humanIdempotencyService?: HumanIdempotencyService,
  ) {}

  createForAgent(
    ownerId: string,
    input: AgentReminderInput,
    transaction?: Prisma.TransactionClient
  ): Promise<AgentReminderResult> {
    if (transaction) {
      return this.createForAgentInTransaction(transaction, ownerId, input);
    }
    return this.prisma.$transaction(
      (tx) => this.createForAgentInTransaction(tx, ownerId, input),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async create(
    userId: string,
    dto: CreateReminderDto,
    idempotencyKey?: string,
  ) {
    if (idempotencyKey) {
      if (!this.humanIdempotencyService) {
        throw new Error('Human idempotency service is unavailable.');
      }
      const result = await this.humanIdempotencyService.execute(
        userId,
        'reminder:create',
        idempotencyKey,
        dto,
        (tx) => this.createForHumanInTransaction(tx, userId, dto),
      );
      if (!result.replayed) {
        this.notifyReminderCreated(userId, dto, result.value);
      }
      return result.value;
    }

    const reminder = await this.prisma.$transaction(
      (tx) => this.createForHumanInTransaction(tx, userId, dto),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    this.notifyReminderCreated(userId, dto, reminder);
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
          contact: { ownerId: userId, isDemo: false },
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
          contact: { ownerId: userId, isDemo: false },
        },
        _count: true,
      }),
    ]);

    const overdueCount = await this.prisma.reminder.count({
      where: {
        ownerId: userId,
        status: 'pending',
        scheduledAt: { lt: now },
        contact: { ownerId: userId, isDemo: false },
      },
    });

    const todayCount = await this.prisma.reminder.count({
      where: {
        ownerId: userId,
        status: 'pending',
        scheduledAt: { gte: now, lte: endOfToday },
        contact: { ownerId: userId, isDemo: false },
      },
    });

    const thisWeekCount = await this.prisma.reminder.count({
      where: {
        ownerId: userId,
        status: 'pending',
        scheduledAt: { gte: now, lte: endOfWeek },
        contact: { ownerId: userId, isDemo: false },
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
    const updated = await this.prisma.$transaction(
      async (transaction) => {
        const reminder = await transaction.reminder.findFirst({
          where: {
            id: reminderId,
            ownerId: userId,
            status: 'pending',
            contact: { ownerId: userId, isDemo: false },
          },
          select: {
            id: true,
            contactId: true,
            ownerId: true,
            type: true,
            title: true,
            description: true,
            scheduledAt: true,
            repeatInterval: true,
            isRecurring: true,
            status: true,
            contact: {
              select: {
                ownerId: true,
                isDemo: true,
              },
            },
          },
        });

        if (
          !reminder ||
          reminder.ownerId !== userId ||
          reminder.contact.ownerId !== userId ||
          reminder.contact.isDemo ||
          reminder.status !== 'pending'
        ) {
          throw new NotFoundException('Reminder not found');
        }

        const completedAt = new Date();
        const claim = await transaction.reminder.updateMany({
          where: { id: reminderId, ownerId: userId, status: 'pending' },
          data: { status: 'completed', completedAt },
        });
        if (claim.count !== 1) {
          throw new NotFoundException('Reminder not found');
        }

        if (reminder.isRecurring && reminder.repeatInterval) {
          await transaction.reminder.create({
            data: {
              contactId: reminder.contactId,
              ownerId: userId,
              type: reminder.type,
              title: reminder.title,
              description: reminder.description,
              scheduledAt: this.calculateNextDate(
                new Date(reminder.scheduledAt),
                reminder.repeatInterval,
              ),
              repeatInterval: reminder.repeatInterval,
              isRecurring: true,
            },
          });
        }

        return transaction.reminder.findUniqueOrThrow({
          where: { id: reminderId },
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Send celebration/achievement-style notification on completion
    if (
      !updated.contact.isDemo &&
      ['birthday', 'anniversary', 'followup'].includes(updated.type)
    ) {
      const contactName = `${updated.contact.firstName}${updated.contact.lastName ? ` ${updated.contact.lastName}` : ''}`;
      this.notificationsService.sendReminderNotification(userId, {
        contactName,
        type: updated.type as 'birthday' | 'anniversary' | 'followup',
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

  private async createForHumanInTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
    dto: CreateReminderDto,
  ) {
    const contact = await transaction.contact.findFirst({
      where: { id: dto.contactId, ownerId: userId, isDemo: false },
    });
    if (!contact || contact.isDemo) {
      throw new NotFoundException('Contact not found');
    }

    return transaction.reminder.create({
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
  }

  private notifyReminderCreated(
    userId: string,
    dto: CreateReminderDto,
    reminder: { contact: { firstName: string; lastName: string | null } },
  ): void {
    if (!['birthday', 'anniversary', 'followup'].includes(dto.type)) return;
    const contactName = `${reminder.contact.firstName}${reminder.contact.lastName ? ` ${reminder.contact.lastName}` : ''}`;
    void this.notificationsService.sendReminderNotification(userId, {
      contactName,
      type: dto.type as 'birthday' | 'anniversary' | 'followup',
      date: new Date(dto.scheduledAt).toLocaleDateString(),
    }).catch(err => console.error('Failed to send reminder notification:', err));
  }

  private async createForAgentInTransaction(
    transaction: Prisma.TransactionClient,
    ownerId: string,
    input: AgentReminderInput
  ): Promise<AgentReminderResult> {
    const contact = await transaction.contact.findFirst({
      where: { id: input.contactId, ownerId, isDemo: false },
      select: { id: true, ownerId: true, isDemo: true },
    });
    if (!contact || contact.ownerId !== ownerId || contact.isDemo) {
      throw new NotFoundException("Contact not found");
    }

    const reminder = await transaction.reminder.create({
      data: {
        contactId: input.contactId,
        ownerId,
        type: input.type,
        title: input.title,
        description: input.description,
        scheduledAt: new Date(input.scheduledAt),
        repeatInterval: input.repeatInterval,
        isRecurring: input.isRecurring ?? false,
      },
      select: {
        id: true,
        contactId: true,
        type: true,
        title: true,
        scheduledAt: true,
        status: true,
      },
    });

    return {
      reminderId: reminder.id,
      contactId: reminder.contactId,
      type: reminder.type,
      title: reminder.title,
      scheduledAt: reminder.scheduledAt,
      status: reminder.status,
    };
  }
}
