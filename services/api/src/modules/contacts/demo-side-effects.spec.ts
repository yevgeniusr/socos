import type { PrismaService } from '../prisma/prisma.service.js';
import type { GamificationService } from '../gamification/gamification.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import { ContactsService } from './contacts.service.js';
import { InteractionsService } from '../interactions/interactions.service.js';
import { InteractionType } from '../interactions/interactions.dto.js';
import { AgentRemindersService } from '../reminders/agent-reminders.service.js';
import { RemindersService } from '../reminders/reminders.service.js';
import { ReminderType } from '../reminders/reminders.dto.js';

const userId = 'synthetic-user';
const contactId = 'synthetic-demo-contact';

function demoInteractionPrisma() {
  return {
    contact: {
      findFirst: jest.fn().mockResolvedValue({ id: contactId, isDemo: true }),
      update: jest.fn().mockResolvedValue({}),
    },
    interaction: {
      create: jest.fn().mockResolvedValue({
        id: 'synthetic-interaction',
        type: 'note',
        title: 'Synthetic note',
        occurredAt: new Date('2026-07-16T00:00:00Z'),
        xpEarned: 0,
      }),
    },
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ xp: 240, level: 2 }),
      update: jest.fn(),
    },
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
  it('logs a contact interaction with zero XP and no reward side effects', async () => {
    const prisma = demoInteractionPrisma();
    const gamification = gamificationMock();
    const service = new ContactsService(
      prisma as unknown as PrismaService,
      gamification as unknown as GamificationService,
    );

    const result = await service.createInteraction(userId, contactId, {
      type: 'note',
      title: 'Synthetic note',
    });

    expect(prisma.interaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ xpEarned: 0 }) }),
    );
    expect(prisma.contact.update).toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(gamification.calculateInteractionXp).not.toHaveBeenCalled();
    expect(gamification.checkLevelUp).not.toHaveBeenCalled();
    expect(gamification.checkAchievements).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      interaction: { xpEarned: 0 },
      user: { xp: 240, level: 2, xpToNextLevel: 400 },
      newAchievements: [],
    });
  });

  it('applies the same zero-XP policy through the interactions service', async () => {
    const prisma = demoInteractionPrisma();
    const gamification = gamificationMock();
    const service = new InteractionsService(
      prisma as unknown as PrismaService,
      gamification as unknown as GamificationService,
    );

    await service.create(userId, {
      contactId,
      type: InteractionType.NOTE,
      title: 'Synthetic note',
    });

    expect(prisma.interaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ xpEarned: 0 }) }),
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
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

  it('creates a manual demo reminder without sending a notification', async () => {
    const reminder = {
      id: 'synthetic-reminder',
      contact: { firstName: 'Synthetic', lastName: 'Contact' },
    };
    const prisma = {
      contact: { findFirst: jest.fn().mockResolvedValue({ isDemo: true }) },
      reminder: { create: jest.fn().mockResolvedValue(reminder) },
    };
    const notifications = { sendReminderNotification: jest.fn() };
    const service = new RemindersService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );

    const result = await service.create(userId, {
      contactId,
      type: ReminderType.FOLLOWUP,
      title: 'Synthetic reminder',
      scheduledAt: '2026-07-20T09:00:00Z',
    });

    expect(result).toBe(reminder);
    expect(prisma.reminder.create).toHaveBeenCalled();
    expect(notifications.sendReminderNotification).not.toHaveBeenCalled();
  });

  it('completes a demo reminder without sending a completion notification', async () => {
    const prisma = {
      reminder: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'synthetic-reminder',
          contactId,
          type: 'followup',
          isRecurring: false,
        }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({
          id: 'synthetic-reminder',
          contact: {
            firstName: 'Synthetic',
            lastName: 'Contact',
            isDemo: true,
          },
        }),
      },
    };
    const notifications = { sendReminderNotification: jest.fn() };
    const service = new RemindersService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService,
    );

    const result = await service.complete(userId, 'synthetic-reminder');

    expect(result.id).toBe('synthetic-reminder');
    expect(prisma.reminder.update).toHaveBeenCalled();
    expect(notifications.sendReminderNotification).not.toHaveBeenCalled();
  });
});
