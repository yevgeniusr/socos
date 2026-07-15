import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiDmService } from './ai-dm.service.js';
import {
  CreateSessionDto,
  SubmitResponseDto,
  ScenePromptContext,
  DMScenarioDto,
  DMSessionDto,
  DebriefDto,
} from './dungeon-master.dto.js';
import { SCENARIOS, DMScenario } from './dm-scenarios.data.js';
import {
  dmSessionMachine,
  stateValueToStatus,
  statusToStateValue,
  getNextState,
  isSessionExpired,
} from './dm-state-machine.js';
import { createActor, assign } from 'xstate';
import { Interpreter } from 'xstate'; // eslint-disable-line @typescript-eslint/no-unused-vars

// How long each scene window lasts (48 hours)
const SCENE_DEADLINE_HOURS = 48;
const LLM_CLAIM_TIMEOUT_MS = 5 * 60 * 1000;

@Injectable()
export class DungeonMasterService {
  private actor: ReturnType<typeof createActor<any>>;

  constructor(
    private prisma: PrismaService,
    private aiDm: AiDmService,
  ) {
    // Initialize XState actor
    this.actor = createActor(dmSessionMachine);
    this.actor.start();
  }

  // ===================== SCENARIOS =====================

  /**
   * List all available scenario archetypes.
   * Seeds DB on first call if empty.
   */
  async listScenarios(): Promise<DMScenarioDto[]> {
    await this.seedScenarios();

    const scenarios = await this.prisma.dungeonMasterScenario.findMany({
      orderBy: { createdAt: 'asc' },
    });

    return scenarios.map(this.mapScenarioToDto);
  }

  // ===================== SESSIONS =====================

  /**
   * Create a new DM session between two matched users.
   * One user initiates; both participants stored.
   */
  async createSession(dto: CreateSessionDto, inviterId: string): Promise<DMSessionDto> {
    if (dto.participants.length !== 2) {
      throw new BadRequestException('Exactly 2 participants required for a DM session.');
    }

    if (!dto.participants.includes(inviterId)) {
      throw new BadRequestException('The authenticated user must be a participant.');
    }

    const invitedId = dto.participants.find((id) => id !== inviterId);
    if (!invitedId || new Set(dto.participants).size !== 2) {
      throw new BadRequestException('DM session participants must be two distinct users.');
    }

    const participants = [inviterId, invitedId];
    const existingUsers = await this.prisma.user.count({
      where: { id: { in: participants } },
    });
    if (existingUsers !== 2) {
      throw new NotFoundException('One or both user profiles not found.');
    }

    const scenario = await this.prisma.dungeonMasterScenario.findUnique({
      where: { id: dto.scenarioId },
    });

    if (!scenario) {
      throw new NotFoundException(`Scenario ${dto.scenarioId} not found.`);
    }

    const session = await this.prisma.dMSession.create({
      data: {
        scenarioId: dto.scenarioId,
        participants,
        currentScene: 0,
        status: 'waiting',
        deadline: new Date(Date.now() + SCENE_DEADLINE_HOURS * 60 * 60 * 1000),
      },
      include: {
        scenario: true,
        responses: true,
      },
    });

    return this.mapSessionToDto(session);
  }

  /** Accept a pending invitation. Only the invited participant can activate it. */
  async acceptSession(sessionId: string, userId: string): Promise<DMSessionDto> {
    const session = await this.getSession(sessionId, userId);

    if (session.participants[1] !== userId) {
      throw new BadRequestException('Only the invited participant can accept this session.');
    }
    if (session.status !== 'waiting') {
      throw new BadRequestException(`Session invitation is not pending. Current: ${session.status}`);
    }

    const updated = await this.prisma.dMSession.update({
      where: { id: sessionId },
      data: {
        status: 'active',
        startedAt: new Date(),
        deadline: new Date(Date.now() + SCENE_DEADLINE_HOURS * 60 * 60 * 1000),
      },
      include: {
        scenario: true,
        responses: { orderBy: { submittedAt: 'asc' } },
      },
    });

    this.actor.send({ type: 'START' });
    return this.mapSessionToDto(updated);
  }

  /**
   * Get session by ID. Checks for expiration.
   */
  async getSession(sessionId: string, userId: string): Promise<DMSessionDto> {
    const session = await this.prisma.dMSession.findFirst({
      where: {
        id: sessionId,
        participants: { has: userId },
      },
      include: {
        scenario: true,
        responses: {
          orderBy: { submittedAt: 'asc' },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found.`);
    }

    const expirableStatuses = ['waiting', 'active', 'scene_submission', 'scene_review'];
    if (isSessionExpired(session.deadline) && expirableStatuses.includes(session.status)) {
      const expired = await this.prisma.dMSession.updateMany({
        where: {
          id: sessionId,
          status: session.status,
          deadline: { lte: new Date() },
        },
        data: { status: 'expired' },
      });
      if (expired.count === 1) session.status = 'expired';
    }

    return this.mapSessionToDto(session);
  }

  /**
   * Begin the next scene (advance from active → scene_submission).
   * This generates the AI narration for the new scene.
   */
  async beginScene(sessionId: string, userId: string): Promise<DMSessionDto> {
    const session = await this.getSession(sessionId, userId);

    const claimStartedAt = new Date();
    let claim;
    if (session.status === 'active') {
      claim = await this.prisma.dMSession.updateMany({
        where: {
          id: sessionId,
          status: 'active',
          currentScene: session.currentScene,
        },
        data: {
          status: 'scene_processing',
          sceneStartedAt: claimStartedAt,
        },
      });
    } else if (
      session.status === 'scene_processing' &&
      session.sceneStartedAt &&
      session.sceneStartedAt.getTime() < Date.now() - LLM_CLAIM_TIMEOUT_MS
    ) {
      claim = await this.prisma.dMSession.updateMany({
        where: {
          id: sessionId,
          status: 'scene_processing',
          currentScene: session.currentScene,
          sceneStartedAt: {
            lt: new Date(Date.now() - LLM_CLAIM_TIMEOUT_MS),
          },
        },
        data: { sceneStartedAt: claimStartedAt },
      });
    } else {
      throw new BadRequestException(`Session must be active to begin a scene. Current: ${session.status}`);
    }

    if (claim.count !== 1) {
      throw new ConflictException('Another request is generating this scene.');
    }

    try {
      const narrative = await this.generateSceneNarrative(session, session.currentScene);

      const completed = await this.prisma.dMSession.updateMany({
        where: {
          id: sessionId,
          status: 'scene_processing',
          currentScene: session.currentScene,
          sceneStartedAt: claimStartedAt,
        },
        data: {
          status: 'scene_submission',
          sceneStartedAt: null,
          currentNarrative: narrative,
          deadline: new Date(Date.now() + SCENE_DEADLINE_HOURS * 60 * 60 * 1000),
        },
      });
      if (completed.count !== 1) {
        throw new ConflictException('Scene generation claim was lost.');
      }

      const updated = await this.prisma.dMSession.findUnique({
        where: { id: sessionId },
        include: {
          scenario: true,
          responses: { orderBy: { submittedAt: 'asc' } },
        },
      });
      if (!updated) {
        throw new NotFoundException(`Session ${sessionId} not found.`);
      }

      this.actor.send({ type: 'BEGIN_SCENE' });

      return this.mapSessionToDto(updated);
    } catch (error) {
      await this.prisma.dMSession
        .updateMany({
          where: {
            id: sessionId,
            status: 'scene_processing',
            currentScene: session.currentScene,
            sceneStartedAt: claimStartedAt,
          },
          data: { status: 'active', sceneStartedAt: null },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  /**
   * Submit a user's response for the current scene.
   */
  async submitResponse(sessionId: string, userId: string, dto: SubmitResponseDto): Promise<DMSessionDto> {
    const session = await this.getSession(sessionId, userId);

    if (session.status !== 'scene_submission') {
      throw new BadRequestException(`Session must be in scene_submission to respond. Current: ${session.status}`);
    }

    // Check if already responded for this scene
    const existing = await this.prisma.dMSceneResponse.findFirst({
      where: { sessionId, userId, sceneIndex: session.currentScene },
    });

    if (existing) {
      throw new BadRequestException('You have already responded to this scene.');
    }

    // Save the response
    await this.prisma.dMSceneResponse.create({
      data: {
        sessionId,
        userId,
        sceneIndex: session.currentScene,
        content: dto.content,
      },
    });

    this.actor.send({ type: 'SUBMIT_RESPONSE', userId } as any);

    // Reload responses
    const updated = await this.prisma.dMSession.findUnique({
      where: { id: sessionId },
      include: {
        scenario: true,
        responses: { orderBy: { submittedAt: 'asc' } },
      },
    });

    // If both responded, advance to scene_review
    const allResponses = updated!.responses.filter((r) => r.sceneIndex === updated!.currentScene);
    if (allResponses.length >= 2) {
      await this.prisma.dMSession.update({
        where: { id: sessionId },
        data: { status: 'scene_review' },
      });
      this.actor.send({ type: 'REVIEW_SCENE' });
    }

    const final = await this.prisma.dMSession.findUnique({
      where: { id: sessionId },
      include: {
        scenario: true,
        responses: { orderBy: { submittedAt: 'asc' } },
      },
    });

    return this.mapSessionToDto(final!);
  }

  /**
   * Advance to the next scene (called after AI synthesizes).
   */
  async advanceScene(sessionId: string, userId: string): Promise<DMSessionDto> {
    const session = await this.getSession(sessionId, userId);

    if (session.status !== 'scene_review') {
      throw new BadRequestException(`Must be in scene_review to advance. Current: ${session.status}`);
    }

    const nextState = getNextState(session.currentScene, session.scenario.totalScenes);

    if (nextState === 'debrief') {
      await this.prisma.dMSession.update({
        where: { id: sessionId },
        data: {
          status: 'debrief',
          currentScene: session.currentScene + 1,
          deadline: null,
        },
      });
      this.actor.send({ type: 'BEGIN_DEBRIEF' });
    } else {
      await this.prisma.dMSession.update({
        where: { id: sessionId },
        data: {
          status: 'active',
          currentScene: session.currentScene + 1,
          currentNarrative: null,
        },
      });
      this.actor.send({ type: 'ADVANCE_SCENE' });
    }

    const updated = await this.prisma.dMSession.findUnique({
      where: { id: sessionId },
      include: {
        scenario: true,
        responses: { orderBy: { submittedAt: 'asc' } },
      },
    });

    return this.mapSessionToDto(updated!);
  }

  /**
   * Get AI debrief after session reaches debrief state.
   */
  async getDebrief(sessionId: string, userId: string): Promise<DebriefDto> {
    const session = await this.getSession(sessionId, userId);

    if (session.status === 'completed') {
      const persisted = this.asPersistedDebrief(session.debrief);
      if (!persisted) {
        throw new BadRequestException('Completed session is missing its debrief.');
      }
      return persisted;
    }

    const claimStartedAt = new Date();
    let claim;
    if (session.status === 'debrief') {
      claim = await this.prisma.dMSession.updateMany({
        where: { id: sessionId, status: 'debrief' },
        data: {
          status: 'debrief_processing',
          debriefStartedAt: claimStartedAt,
        },
      });
    } else if (
      session.status === 'debrief_processing' &&
      session.debriefStartedAt &&
      session.debriefStartedAt.getTime() < Date.now() - LLM_CLAIM_TIMEOUT_MS
    ) {
      claim = await this.prisma.dMSession.updateMany({
        where: {
          id: sessionId,
          status: 'debrief_processing',
          debriefStartedAt: {
            lt: new Date(Date.now() - LLM_CLAIM_TIMEOUT_MS),
          },
        },
        data: { debriefStartedAt: claimStartedAt },
      });
    } else {
      throw new ConflictException(`Debrief is not ready for generation. Current: ${session.status}`);
    }

    if (claim.count !== 1) {
      throw new ConflictException('Another request is generating this debrief.');
    }

    try {
      // Collect all responses
      const responses = await this.prisma.dMSceneResponse.findMany({
        where: { sessionId },
        orderBy: { submittedAt: 'asc' },
      });

      // Get user profiles
      const [userAId, userBId] = session.participants;
      const [userA, userB] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userAId },
          select: { id: true, name: true },
        }),
        this.prisma.user.findUnique({
          where: { id: userBId },
          select: { id: true, name: true },
        }),
      ]);

      if (!userA || !userB) {
        throw new NotFoundException('One or both user profiles not found.');
      }

      const ctx: ScenePromptContext = {
        scenarioName: session.scenario.name,
        scenarioArchetype: session.scenario.archetype,
        setting: 'Debrief',
        userA,
        userB,
        sceneIndex: session.currentScene,
        totalScenes: session.scenario.totalScenes,
        sceneDescription: 'Final debrief',
        userAResponse: null,
        userBResponse: null,
      };

      const prompt = this.aiDm.buildDebriefPrompt(
        ctx,
        responses.map((r) => ({ userId: r.userId, content: r.content })),
      );

      const rawDebrief = await this.aiDm.callAI(prompt);

      let modelDebrief: unknown;
      try {
        modelDebrief = JSON.parse(rawDebrief);
      } catch {
        throw new BadRequestException('Failed to parse AI debrief response.');
      }

      if (!this.isValidDebrief(modelDebrief)) {
        throw new BadRequestException('AI debrief response has an invalid shape.');
      }

      const xpAwarded = Math.max(0, Math.min(session.scenario.xpReward, 500));
      const debrief: DebriefDto = { ...modelDebrief, xpAwarded };
      const finishedAt = new Date();

      await this.prisma.$transaction(async (tx) => {
        const completed = await tx.dMSession.updateMany({
          where: {
            id: sessionId,
            status: 'debrief_processing',
            debriefStartedAt: claimStartedAt,
          },
          data: {
            status: 'completed',
            debrief: debrief as unknown as Prisma.InputJsonValue,
            debriefStartedAt: null,
            xpAwardedAt: finishedAt,
          },
        });
        if (completed.count !== 1) {
          throw new ConflictException('Debrief generation claim was lost.');
        }

        for (const participantId of session.participants) {
          await tx.user.update({
            where: { id: participantId },
            data: { xp: { increment: xpAwarded } },
          });
        }
      });
      this.actor.send({ type: 'COMPLETE' });

      return debrief;
    } catch (error) {
      await this.prisma.dMSession
        .updateMany({
          where: {
            id: sessionId,
            status: 'debrief_processing',
            debriefStartedAt: claimStartedAt,
          },
          data: { status: 'debrief', debriefStartedAt: null },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  // ===================== PRIVATE HELPERS =====================

  private isValidDebrief(value: unknown): value is Omit<DebriefDto, 'xpAwarded'> & { xpAwarded?: unknown } {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.narrative === 'string' &&
      Array.isArray(candidate.connectionHighlights) &&
      candidate.connectionHighlights.every((item) => typeof item === 'string') &&
      Array.isArray(candidate.recommendedNextSteps) &&
      candidate.recommendedNextSteps.every((item) => typeof item === 'string')
    );
  }

  private asPersistedDebrief(value: unknown): DebriefDto | null {
    if (!this.isValidDebrief(value)) return null;
    const xpAwarded = (value as { xpAwarded?: unknown }).xpAwarded;
    return typeof xpAwarded === 'number' && Number.isFinite(xpAwarded) ? { ...value, xpAwarded } : null;
  }

  /**
   * Generate AI narration for a specific scene.
   */
  private async generateSceneNarrative(session: DMSessionDto, sceneIndex: number): Promise<string> {
    const scenario = session.scenario;
    const scenes = scenario.scenes as Array<{
      description: string;
      setting: string;
    }>;
    const sceneConfig = scenes[sceneIndex] ?? scenes[0];

    const [userAId, userBId] = session.participants;
    const [userA, userB] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userAId },
        select: { id: true, name: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userBId },
        select: { id: true, name: true },
      }),
    ]);

    if (!userA || !userB) {
      throw new NotFoundException('One or both user profiles not found.');
    }

    // Check for prior responses for this scene
    const responses = await this.prisma.dMSceneResponse.findMany({
      where: { sessionId: session.id, sceneIndex },
    });

    const userAResponse = responses.find((r) => r.userId === userAId);
    const userBResponse = responses.find((r) => r.userId === userBId);

    const ctx: ScenePromptContext = {
      scenarioName: scenario.name,
      scenarioArchetype: scenario.archetype as 'mystery' | 'adventure' | 'intimate',
      setting: sceneConfig.setting,
      userA,
      userB,
      sceneIndex,
      totalScenes: scenario.totalScenes,
      sceneDescription: sceneConfig.description,
      userAResponse: userAResponse?.content ?? null,
      userBResponse: userBResponse?.content ?? null,
    };

    const prompt = this.aiDm.buildScenePrompt(ctx);
    return this.aiDm.callAI(prompt);
  }

  /**
   * Seed scenario DB if empty.
   */
  private async seedScenarios(): Promise<void> {
    const count = await this.prisma.dungeonMasterScenario.count();
    if (count > 0) return;

    for (const scenario of SCENARIOS) {
      await this.prisma.dungeonMasterScenario.create({
        data: {
          id: scenario.id,
          name: scenario.name,
          archetype: scenario.archetype,
          description: scenario.description,
          openingText: scenario.openingText,
          scenes: scenario.scenes as any,
          xpReward: scenario.xpReward,
          totalScenes: scenario.totalScenes,
        },
      });
    }
  }

  // ===================== MAPPERS =====================

  private mapScenarioToDto(s: any): DMScenarioDto {
    return {
      id: s.id,
      name: s.name,
      archetype: s.archetype,
      description: s.description,
      openingText: s.openingText,
      scenes: s.scenes,
      xpReward: s.xpReward,
      totalScenes: s.totalScenes,
    };
  }

  private mapSessionToDto(s: any): DMSessionDto {
    return {
      id: s.id,
      scenarioId: s.scenarioId,
      scenario: this.mapScenarioToDto(s.scenario),
      participants: s.participants,
      currentScene: s.currentScene,
      status: s.status,
      currentNarrative: s.currentNarrative ?? null,
      sceneStartedAt: s.sceneStartedAt ?? null,
      debrief: s.debrief ?? null,
      debriefStartedAt: s.debriefStartedAt ?? null,
      xpAwardedAt: s.xpAwardedAt ?? null,
      startedAt: s.startedAt ?? null,
      deadline: s.deadline ?? null,
      createdAt: s.createdAt,
      responses: (s.responses ?? []).map((r: any) => ({
        id: r.id,
        sessionId: r.sessionId,
        userId: r.userId,
        sceneIndex: r.sceneIndex,
        content: r.content,
        submittedAt: r.submittedAt,
      })),
    };
  }
}
