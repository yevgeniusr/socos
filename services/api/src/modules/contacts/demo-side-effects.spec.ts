import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { GamificationService } from '../gamification/gamification.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { InteractionsService } from '../interactions/interactions.service.js';
import { InteractionType } from '../interactions/interactions.dto.js';
import { AgentRemindersService } from '../reminders/agent-reminders.service.js';
import { RemindersService } from '../reminders/reminders.service.js';
import { ReminderType } from '../reminders/reminders.dto.js';

const userId = 'synthetic-user';
const contactId = 'synthetic-demo-contact';

function demoInteractionPrisma() {
  const transaction = {
    contact: {
      findFirst: jest.fn().mockResolvedValue({
        id: contactId,
        ownerId: userId,
        isDemo: true,
      }),
      updateMany: jest.fn(),
    },
    interaction: {
      create: jest.fn(),
    },
  };
  return {
    ...transaction,
    $transaction: jest.fn().mockImplementation((callback) => callback(transaction)),
  };
}

function gamificationMock() {
  return {
    calculateInteractionXp: jest.fn().mockResolvedValue(10),
    checkLevelUp: jest.fn(),
    checkAchievements: jest.fn(),
  };
}

describe('demo contact side effects', () => {
  it('rejects manual interactions for demo contacts without side effects', async () => {
    const prisma = demoInteractionPrisma();
    const gamification = gamificationMock();
    const service = new InteractionsService(
      prisma as unknown as PrismaService,
      gamification as unknown as GamificationService,
    );

    await expect(
      service.create(userId, {
        contactId,
        type: InteractionType.NOTE,
        title: 'Synthetic note',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.interaction.create).not.toHaveBeenCalled();
    expect(prisma.contact.updateMany).not.toHaveBeenCalled();
    expect(gamification.calculateInteractionXp).not.toHaveBeenCalled();
    expect(gamification.checkLevelUp).not.toHaveBeenCalled();
    expect(gamification.checkAchievements).not.toHaveBeenCalled();
  });

  it('rejects proactive agent reminder scheduling for a demo contact', async () => {
    const prisma = {
      contact: { findFirst: jest.fn().mockResolvedValue({ isDemo: true }) },
      reminder: { create: jest.fn() },
    };
    const notifications = { sendReminderNotification: jest.fn() };
    const service = new AgentRemindersService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );

    const result = await service.scheduleReminder(userId, {
      contactId,
      type: ReminderType.FOLLOWUP,
      scheduledAt: '2026-07-20T09:00:00Z',
    });

    expect(result).toEqual({ reminderId: '', success: false });
    expect(prisma.reminder.create).not.toHaveBeenCalled();
    expect(notifications.sendReminderNotification).not.toHaveBeenCalled();
  });

  it('rejects a manual demo reminder without side effects', async () => {
    const prisma = {
      contact: {
        findFirst: jest.fn().mockResolvedValue({
          id: contactId,
          ownerId: userId,
          isDemo: true,
        }),
      },
      reminder: { create: jest.fn() },
    };
    const notifications = { sendReminderNotification: jest.fn() };
    const service = new RemindersService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );

    await expect(
      service.create(userId, {
        contactId,
        type: ReminderType.FOLLOWUP,
        title: 'Synthetic reminder',
        scheduledAt: '2026-07-20T09:00:00Z',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { id: contactId, ownerId: userId, isDemo: false },
    });
    expect(prisma.reminder.create).not.toHaveBeenCalled();
    expect(notifications.sendReminderNotification).not.toHaveBeenCalled();
  });

  it('rejects completion for a demo reminder without side effects', async () => {
    const transaction = {
      reminder: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'synthetic-reminder',
          contactId,
          ownerId: userId,
          type: 'followup',
          title: 'Synthetic reminder',
          description: null,
          scheduledAt: new Date('2026-07-20T09:00:00Z'),
          repeatInterval: null,
          isRecurring: false,
          status: 'pending',
          contact: { ownerId: userId, isDemo: true },
        }),
        create: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((callback) => callback(transaction)),
    };
    const notifications = { sendReminderNotification: jest.fn() };
    const service = new RemindersService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );

    await expect(
      service.complete(userId, 'synthetic-reminder'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(transaction.reminder.updateMany).not.toHaveBeenCalled();
    expect(transaction.reminder.create).not.toHaveBeenCalled();
    expect(notifications.sendReminderNotification).not.toHaveBeenCalled();
  });
});
