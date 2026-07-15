import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AiDmService } from './ai-dm.service.js';
import { DungeonMasterService } from './dungeon-master.service.js';

describe('DungeonMasterService ownership', () => {
  const prisma = {
    dMSession: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    dungeonMasterScenario: { findUnique: jest.fn() },
    dMSceneResponse: { findMany: jest.fn() },
    user: {
      count: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not return a session to a non-participant', async () => {
    prisma.dMSession.findFirst.mockResolvedValue(null);
    const service = new DungeonMasterService(prisma as unknown as PrismaService, {} as AiDmService);

    await expect(service.getSession('private-session', 'unrelated-user')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.dMSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'private-session',
          participants: { has: 'unrelated-user' },
        },
      }),
    );
    expect(prisma.dMSession.update).not.toHaveBeenCalled();
  });

  it('creates a pending invitation with the authenticated inviter first', async () => {
    prisma.dungeonMasterScenario.findUnique.mockResolvedValue({
      id: 'scenario-1',
    });
    prisma.user.count.mockResolvedValue(2);
    prisma.dMSession.create.mockResolvedValue({
      id: 'session-1',
      participants: ['inviter', 'invited-user'],
      scenario: {},
      responses: [],
    });
    const service = new DungeonMasterService(prisma as unknown as PrismaService, {} as AiDmService);

    await service.createSession({ scenarioId: 'scenario-1', participants: ['invited-user', 'inviter'] }, 'inviter');

    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { id: { in: ['inviter', 'invited-user'] } },
    });
    expect(prisma.dMSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          participants: ['inviter', 'invited-user'],
          status: 'waiting',
        }),
      }),
    );
  });

  it('rejects fake, duplicate, and caller-excluding participants', async () => {
    prisma.dungeonMasterScenario.findUnique.mockResolvedValue({
      id: 'scenario-1',
    });
    const service = new DungeonMasterService(prisma as unknown as PrismaService, {} as AiDmService);

    await expect(
      service.createSession({ scenarioId: 'scenario-1', participants: ['other-a', 'other-b'] }, 'inviter'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createSession({ scenarioId: 'scenario-1', participants: ['inviter', 'inviter'] }, 'inviter'),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.user.count.mockResolvedValue(1);
    await expect(
      service.createSession({ scenarioId: 'scenario-1', participants: ['inviter', 'missing-user'] }, 'inviter'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows only the invited participant to activate a waiting session', async () => {
    prisma.dMSession.findFirst.mockResolvedValue({
      id: 'session-1',
      participants: ['inviter', 'invited-user'],
      status: 'waiting',
      scenario: {},
      responses: [],
      deadline: new Date(Date.now() + 60_000),
    });
    prisma.dMSession.update.mockResolvedValue({
      id: 'session-1',
      participants: ['inviter', 'invited-user'],
      status: 'active',
      scenario: {},
      responses: [],
    });
    const service = new DungeonMasterService(prisma as unknown as PrismaService, {} as AiDmService);

    await expect(service.acceptSession('session-1', 'inviter')).rejects.toBeInstanceOf(BadRequestException);
    await service.acceptSession('session-1', 'invited-user');

    expect(prisma.dMSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1' },
        data: expect.objectContaining({ status: 'active' }),
      }),
    );
  });

  it('claims scene generation before calling the model', async () => {
    prisma.dMSession.findFirst.mockResolvedValue({
      id: 'session-1',
      participants: ['user-a', 'user-b'],
      currentScene: 0,
      status: 'active',
      sceneStartedAt: null,
      deadline: null,
      scenario: {},
      responses: [],
    });
    prisma.dMSession.updateMany.mockResolvedValue({ count: 0 });
    const aiDm = { callAI: jest.fn() };
    const service = new DungeonMasterService(prisma as unknown as PrismaService, aiDm as unknown as AiDmService);

    await expect(service.beginScene('session-1', 'user-a')).rejects.toBeInstanceOf(ConflictException);
    expect(aiDm.callAI).not.toHaveBeenCalled();
  });

  it('does not expire an in-progress debrief claim at the old scene deadline', async () => {
    prisma.dMSession.findFirst.mockResolvedValue({
      id: 'session-1',
      participants: ['user-a', 'user-b'],
      currentScene: 3,
      status: 'debrief_processing',
      debriefStartedAt: new Date(),
      deadline: new Date(Date.now() - 60_000),
      scenario: {},
      responses: [],
    });
    const service = new DungeonMasterService(prisma as unknown as PrismaService, {} as AiDmService);

    const result = await service.getSession('session-1', 'user-a');

    expect(result.status).toBe('debrief_processing');
    expect(prisma.dMSession.updateMany).not.toHaveBeenCalled();
  });

  it('awards fixed scenario XP once even when the model requests more', async () => {
    const session = {
      id: 'session-1',
      participants: ['user-a', 'user-b'],
      status: 'debrief',
      debrief: null,
      debriefStartedAt: null,
      currentScene: 3,
      deadline: new Date(Date.now() + 60_000),
      scenario: {
        name: 'Scenario',
        archetype: 'adventure',
        totalScenes: 3,
        xpReward: 120,
      },
      responses: [],
    };
    prisma.dMSession.findFirst.mockResolvedValue(session);
    prisma.dMSceneResponse.findMany.mockResolvedValue([]);
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user-a', name: 'A' })
      .mockResolvedValueOnce({ id: 'user-b', name: 'B' });
    prisma.dMSession.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.update.mockResolvedValue({});
    prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
    const aiDm = {
      buildDebriefPrompt: jest.fn().mockReturnValue('prompt'),
      callAI: jest.fn().mockResolvedValue(
        JSON.stringify({
          narrative: 'Summary',
          connectionHighlights: ['One'],
          xpAwarded: 999999,
          recommendedNextSteps: ['Next'],
        }),
      ),
    };
    const service = new DungeonMasterService(prisma as unknown as PrismaService, aiDm as unknown as AiDmService);

    const result = await service.getDebrief('session-1', 'user-a');

    expect(result.xpAwarded).toBe(120);
    expect(prisma.dMSession.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: 'session-1', status: 'debrief' },
      data: {
        status: 'debrief_processing',
        debriefStartedAt: expect.any(Date),
      },
    });
    expect(prisma.dMSession.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'session-1',
        status: 'debrief_processing',
        debriefStartedAt: expect.any(Date),
      },
      data: {
        status: 'completed',
        debrief: {
          narrative: 'Summary',
          connectionHighlights: ['One'],
          xpAwarded: 120,
          recommendedNextSteps: ['Next'],
        },
        debriefStartedAt: null,
        xpAwardedAt: expect.any(Date),
      },
    });
    expect(prisma.user.update).toHaveBeenCalledTimes(2);
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { xp: { increment: 120 } } }));
  });

  it('returns the persisted debrief to either participant without awarding XP again', async () => {
    const persisted = {
      narrative: 'Persisted summary',
      connectionHighlights: ['One'],
      xpAwarded: 120,
      recommendedNextSteps: ['Next'],
    };
    prisma.dMSession.findFirst.mockResolvedValue({
      id: 'session-1',
      participants: ['user-a', 'user-b'],
      status: 'completed',
      debrief: persisted,
      debriefStartedAt: null,
      xpAwardedAt: new Date(),
      deadline: null,
      scenario: {},
      responses: [],
    });
    const aiDm = { callAI: jest.fn() };
    const service = new DungeonMasterService(prisma as unknown as PrismaService, aiDm as unknown as AiDmService);

    await expect(service.getDebrief('session-1', 'user-a')).resolves.toEqual(persisted);
    await expect(service.getDebrief('session-1', 'user-b')).resolves.toEqual(persisted);
    expect(aiDm.callAI).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('claims debrief generation before calling the model', async () => {
    prisma.dMSession.findFirst.mockResolvedValue({
      id: 'session-1',
      participants: ['user-a', 'user-b'],
      status: 'debrief',
      debrief: null,
      debriefStartedAt: null,
      deadline: null,
      scenario: {},
      responses: [],
    });
    prisma.dMSession.updateMany.mockResolvedValue({ count: 0 });
    const aiDm = { callAI: jest.fn() };
    const service = new DungeonMasterService(prisma as unknown as PrismaService, aiDm as unknown as AiDmService);

    await expect(service.getDebrief('session-1', 'user-a')).rejects.toBeInstanceOf(ConflictException);
    expect(aiDm.callAI).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
