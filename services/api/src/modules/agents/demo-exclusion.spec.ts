import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { JwtService } from '../jwt/jwt.service.js';
import type { AnthropicService } from '../llm/anthropic.service.js';
import type { LlmService } from '../llm/llm.service.js';
import { ContactsService } from '../contacts/contacts.service.js';
import { AgentRemindersService } from '../reminders/agent-reminders.service.js';
import { RemindersService } from '../reminders/reminders.service.js';
import { CelebrationsService } from '../celebrations/celebrations.service.js';
import { NotificationSchedulerService } from '../notifications/notification-scheduler.service.js';
import { GamificationService } from '../gamification/gamification.service.js';
import { AuthService } from '../auth/auth.service.js';
import { AiAgentService } from '../ai-agent/ai-agent.service.js';
import { AgentsService } from './agents.service.js';
import { RelationshipAgent } from './strategies/relationship-agent.js';
import { ReminderAgent } from './strategies/reminder-agent.js';
import { SuggestionAgent } from './strategies/suggestion-agent.js';
import { SummaryAgent } from './strategies/summary-agent.js';

const userId = 'synthetic-user';

describe('demo contact exclusion', () => {
  it('excludes demo contacts from due-contact and agent-tool suggestions', async () => {
    const prisma = {
      contact: { findMany: jest.fn().mockResolvedValue([]) },
    };

    await new ContactsService(
      prisma as unknown as PrismaService,
    ).getDueContacts(userId);
    await new AgentRemindersService(
      prisma as unknown as PrismaService,
      {} as NotificationsService,
    ).suggestContacts(userId, {});

    for (const call of prisma.contact.findMany.mock.calls) {
      expect(call[0].where).toMatchObject({ ownerId: userId, isDemo: false });
    }
  });

  it('excludes demo contacts from relationship recommendations and scoring', async () => {
    const prisma = {
      contact: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
    };
    const agent = new RelationshipAgent(prisma as unknown as PrismaService);

    await agent.getRecommendations({ userId });
    await agent.refreshScores(userId);

    for (const call of prisma.contact.findMany.mock.calls) {
      expect(call[0].where).toMatchObject({ ownerId: userId, isDemo: false });
    }
  });

  it('excludes demo contacts from generated and upcoming reminders', async () => {
    const prisma = {
      contact: { findMany: jest.fn().mockResolvedValue([]) },
      reminder: { findMany: jest.fn().mockResolvedValue([]) },
      contactCelebration: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const agent = new ReminderAgent(prisma as unknown as PrismaService);

    await agent.getUpcomingReminders({ userId });
    await agent.suggestBirthdayReminders({ userId });
    await agent.suggestStaleContactReminders({ userId });
    await agent.syncCelebrationReminders({ userId });

    expect(prisma.reminder.findMany.mock.calls[0][0].where.contact).toEqual({
      isDemo: false,
    });
    for (const call of prisma.contact.findMany.mock.calls) {
      expect(call[0].where).toMatchObject({ ownerId: userId, isDemo: false });
    }
    expect(prisma.contactCelebration.findMany.mock.calls[0][0].where.contact).toEqual({
      ownerId: userId,
      isDemo: false,
    });
  });

  it('excludes demo contacts from social suggestions', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ contacts: [] }) },
      contact: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const agent = new SuggestionAgent(prisma as unknown as PrismaService);

    await agent.getSuggestions({ userId });
    await agent.suggestIntroductions({ userId });
    await agent.suggestScoreImprovement({ userId });

    expect(
      prisma.user.findUnique.mock.calls[0][0].include.contacts.where,
    ).toEqual({ isDemo: false });
    for (const call of prisma.contact.findMany.mock.calls) {
      expect(call[0].where).toMatchObject({ ownerId: userId, isDemo: false });
    }
  });

  it('excludes demo contacts from individual and period summaries', async () => {
    const prisma = {
      interaction: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      contact: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      reminder: { count: jest.fn().mockResolvedValue(0) },
    };
    const agent = new SummaryAgent(
      prisma as unknown as PrismaService,
      {} as ConfigService,
    );

    await agent.summarizeInteraction({ userId, interactionId: 'interaction-1' });
    await agent.summarizeContactHistory({ userId, contactId: 'contact-1' });
    await agent.summarizeActivityPeriod({ userId });

    expect(prisma.interaction.findFirst.mock.calls[0][0].where).toMatchObject({
      ownerId: userId,
      contact: { isDemo: false },
    });
    expect(prisma.contact.findFirst.mock.calls[0][0].where).toMatchObject({
      ownerId: userId,
      isDemo: false,
    });
    expect(prisma.interaction.findMany.mock.calls[0][0].where).toMatchObject({
      ownerId: userId,
      contact: { isDemo: false },
    });
    expect(prisma.contact.count.mock.calls[0][0].where).toMatchObject({
      ownerId: userId,
      isDemo: false,
    });
    expect(prisma.reminder.count.mock.calls[0][0].where).toMatchObject({
      ownerId: userId,
      contact: { isDemo: false },
    });
  });

  it('excludes demo contacts from core AI suggestions and health scoring', async () => {
    const prisma = {
      contact: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new AiAgentService(
      prisma as unknown as PrismaService,
      {} as JwtService,
      {} as ConfigService,
      { isConfigured: false } as AnthropicService,
      { isConfigured: false } as LlmService,
    );

    await service.toolSuggestContacts({ userId });
    await expect(
      service.toolAssessRelationshipHealth({ userId, contactId: 'contact-1' }, {}),
    ).rejects.toThrow('not found');

    expect(prisma.contact.findMany.mock.calls[0][0].where).toMatchObject({
      ownerId: userId,
      isDemo: false,
    });
    expect(prisma.contact.findFirst.mock.calls[0][0].where).toMatchObject({
      ownerId: userId,
      isDemo: false,
    });
  });

  it('counts only real contacts in dashboard analytics', async () => {
    const result = { data: [], success: true, executedAt: new Date() };
    const prisma = {
      contact: { count: jest.fn().mockResolvedValue(106) },
    };
    const service = new (AgentsService as any)(
      { getRecommendations: jest.fn().mockResolvedValue(result), refreshScores: jest.fn() },
      { getUpcomingReminders: jest.fn().mockResolvedValue(result) },
      {},
      {},
      { getSuggestions: jest.fn().mockResolvedValue(result) },
      prisma,
    );

    const dashboard = await service.getDashboard({ userId });

    expect(prisma.contact.count).toHaveBeenCalledWith({
      where: { ownerId: userId, isDemo: false },
    });
    expect(dashboard.data.stats.totalContacts).toBe(106);
  });

  it('excludes demo contacts from upcoming reminder feeds and their counts', async () => {
    const prisma = {
      reminder: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };

    await new RemindersService(
      prisma as unknown as PrismaService,
      {} as NotificationsService,
    ).getUpcoming(userId);

    expect(prisma.reminder.findMany.mock.calls[0][0].where.contact).toEqual({
      ownerId: userId,
      isDemo: false,
    });
    expect(prisma.reminder.groupBy.mock.calls[0][0].where.contact).toEqual({
      ownerId: userId,
      isDemo: false,
    });
    for (const call of prisma.reminder.count.mock.calls) {
      expect(call[0].where.contact).toEqual({ ownerId: userId, isDemo: false });
    }
  });

  it('excludes demo contacts from upcoming celebration feeds', async () => {
    const prisma = {
      contactCelebration: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new CelebrationsService(
      prisma as unknown as PrismaService,
      {} as NotificationsService,
    );

    await service.getReminderCelebrations(userId);
    await service.getUpcoming(userId);

    for (const call of prisma.contactCelebration.findMany.mock.calls) {
      expect(call[0].where.contact).toEqual({ isDemo: false });
    }
  });

  it('does not deliver scheduled reminders for demo contacts', async () => {
    const prisma = {
      reminder: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const scheduler = new NotificationSchedulerService(
      prisma as unknown as PrismaService,
      {} as NotificationsService,
    );

    await scheduler.handleDueReminders();

    expect(prisma.reminder.findMany.mock.calls[0][0].where.contact).toEqual({
      isDemo: false,
    });
  });

  it('excludes demo contacts and their interactions from progress analytics', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: userId,
          name: 'Synthetic',
          email: 'synthetic@example.test',
          xp: 0,
          level: 1,
          _count: { contacts: 0, interactions: 0 },
          achievements: [],
        }),
      },
    };
    const service = new GamificationService(
      prisma as unknown as PrismaService,
      {} as NotificationsService,
    );

    await service.getStats(userId);
    expect(
      prisma.user.findUnique.mock.calls[0][0].select._count.select,
    ).toMatchObject({
      contacts: { where: { isDemo: false } },
      interactions: { where: { contact: { isDemo: false } } },
    });

    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      _count: { contacts: 0, interactions: 0 },
      achievements: [],
    });
    await service.checkAchievements(userId);
    expect(
      prisma.user.findUnique.mock.calls[0][0].include._count.select,
    ).toMatchObject({
      contacts: { where: { isDemo: false } },
      interactions: { where: { contact: { isDemo: false } } },
    });
  });

  it('excludes demo contact activity from profile analytics', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          xp: 0,
          level: 1,
          streakDays: 0,
          _count: { contacts: 0, interactions: 0, achievements: 0 },
        }),
      },
    };

    await new AuthService(
      prisma as unknown as PrismaService,
      {} as JwtService,
    ).getUserStats(userId);

    expect(
      prisma.user.findUnique.mock.calls[0][0].include._count.select,
    ).toMatchObject({
      contacts: { where: { isDemo: false } },
      interactions: { where: { contact: { isDemo: false } } },
      reminders: { where: { contact: { isDemo: false } } },
    });
  });
});
