import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { GamificationService } from '../gamification/gamification.service.js';
import {
  CreateInteractionDto,
  InteractionQueryDto,
  InteractionType,
} from './interactions.dto.js';

export interface AgentInteractionInput {
  contactId: string;
  type: InteractionType;
  title?: string;
  content?: string;
  summary?: string;
  occurredAt?: string;
  duration?: number;
  location?: string;
}

export interface AgentInteractionResult {
  interactionId: string;
  contactId: string;
  type: string;
  occurredAt: Date;
  xpAwarded: number;
  totalXp: number;
  level: number;
}

interface InteractionWriteResult extends AgentInteractionResult {
  title: string | null;
  newAchievements: string[];
}

function levelForXp(totalXp: number): number {
  return Math.floor(Math.sqrt(totalXp / 100)) + 1;
}

const AGENT_INTERACTION_ACHIEVEMENTS = [
  {
    code: "first_interaction",
    name: "First Interaction",
    target: 1,
    xpReward: 50,
  },
  {
    code: "prolific",
    name: "Prolific",
    target: 100,
    xpReward: 5000,
  },
] as const;

@Injectable()
export class InteractionsService {
  constructor(
    private prisma: PrismaService,
    private gamificationService: GamificationService,
  ) {}

  async createForAgent(
    ownerId: string,
    input: AgentInteractionInput,
    transaction?: Prisma.TransactionClient
  ): Promise<AgentInteractionResult> {
    const result = transaction
      ? await this.createForAgentInTransaction(transaction, ownerId, input)
      : await this.prisma.$transaction(
          (tx) => this.createForAgentInTransaction(tx, ownerId, input),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        );
    return this.toAgentResult(result);
  }

  async create(userId: string, dto: CreateInteractionDto) {
    const result = await this.prisma.$transaction(
      (tx) => this.createForAgentInTransaction(tx, userId, dto),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return {
      interaction: {
        id: result.interactionId,
        type: result.type,
        title: result.title,
        occurredAt: result.occurredAt,
        xpEarned: result.xpAwarded,
      },
      user: {
        xp: result.totalXp,
        level: result.level,
        xpToNextLevel: Math.pow(result.level, 2) * 100,
      },
      newAchievements: result.newAchievements,
    };
  }

  async findAll(userId: string, query: InteractionQueryDto) {
    const where: any = { ownerId: userId };

    if (query.contactId) {
      where.contactId = query.contactId;
    }

    if (query.type) {
      where.type = query.type;
    }

    const [interactions, total] = await Promise.all([
      this.prisma.interaction.findMany({
        where,
        skip: query.offset || 0,
        take: query.limit || 20,
        orderBy: { occurredAt: 'desc' },
        include: {
          contact: {
            select: { id: true, firstName: true, lastName: true, photo: true },
          },
        },
      }),
      this.prisma.interaction.count({ where }),
    ]);

    return {
      interactions,
      total,
      offset: query.offset || 0,
      limit: query.limit || 20,
    };
  }

  async findByContact(userId: string, contactId: string, limit = 20) {
    // Verify contact belongs to user
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, ownerId: userId },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const interactions = await this.prisma.interaction.findMany({
      where: { contactId, ownerId: userId },
      take: limit,
      orderBy: { occurredAt: 'desc' },
    });

    return interactions;
  }

  async delete(userId: string, interactionId: string) {
    const interaction = await this.prisma.interaction.findFirst({
      where: { id: interactionId, ownerId: userId },
    });

    if (!interaction) {
      throw new NotFoundException('Interaction not found');
    }

    // Remove XP from user
    await this.prisma.user.update({
      where: { id: userId },
      data: { xp: { decrement: interaction.xpEarned } },
    });

    await this.prisma.interaction.delete({
      where: { id: interactionId },
    });

    return { success: true };
  }

  async getTimeline(userId: string, limit = 50) {
    const interactions = await this.prisma.interaction.findMany({
      where: { ownerId: userId },
      take: limit,
      orderBy: { occurredAt: 'desc' },
      include: {
        contact: {
          select: { id: true, firstName: true, lastName: true, photo: true },
        },
      },
    });

    return interactions;
  }

  private async createForAgentInTransaction(
    transaction: Prisma.TransactionClient,
    ownerId: string,
    input: AgentInteractionInput
  ): Promise<InteractionWriteResult> {
    const contact = await transaction.contact.findFirst({
      where: { id: input.contactId, ownerId, isDemo: false },
      select: {
        id: true,
        ownerId: true,
        isDemo: true,
      },
    });
    if (!contact || contact.ownerId !== ownerId || contact.isDemo) {
      throw new NotFoundException("Contact not found");
    }

    const xpAwarded = await this.gamificationService.calculateInteractionXp(
      input.type
    );
    const activityAt = new Date();
    const occurredAt = input.occurredAt
      ? new Date(input.occurredAt)
      : activityAt;
    const interaction = await transaction.interaction.create({
      data: {
        contactId: input.contactId,
        ownerId,
        type: input.type,
        title: input.title,
        content: input.content,
        summary: input.summary,
        occurredAt,
        duration: input.duration,
        location: input.location,
        xpEarned: xpAwarded,
      },
      select: {
        id: true,
        contactId: true,
        type: true,
        title: true,
        occurredAt: true,
        xpEarned: true,
      },
    });

    await transaction.contact.updateMany({
      where: {
        id: input.contactId,
        ownerId,
        isDemo: false,
        OR: [
          { lastContactedAt: null },
          { lastContactedAt: { lt: occurredAt } },
        ],
      },
      data: { lastContactedAt: occurredAt },
    });

    await transaction.xpTransaction.create({
      data: {
        ownerId,
        amount: xpAwarded,
        sourceType: "interaction",
        sourceId: interaction.id,
      },
    });

    const interactionCount = await transaction.interaction.count({
      where: {
        ownerId,
        contact: { ownerId, isDemo: false },
      },
    });
    let achievementXpAwarded = 0;
    const newAchievements: string[] = [];
    for (const definition of AGENT_INTERACTION_ACHIEVEMENTS) {
      if (interactionCount < definition.target) continue;

      const achievement = await transaction.achievement.upsert({
        where: { code: definition.code },
        update: {},
        create: {
          code: definition.code,
          name: definition.name,
          description: `You logged ${definition.target} interactions!`,
          xpReward: definition.xpReward,
          requirement: JSON.stringify({
            type: "count",
            target: definition.target,
            object: "interactions",
          }),
        },
        select: { id: true, xpReward: true },
      });
      const unlock = await transaction.userAchievement.createMany({
        data: [{ userId: ownerId, achievementId: achievement.id }],
        skipDuplicates: true,
      });
      if (unlock.count === 0) continue;

      await transaction.xpTransaction.create({
        data: {
          ownerId,
          amount: achievement.xpReward,
          sourceType: "achievement",
          sourceId: achievement.id,
        },
      });
      achievementXpAwarded += achievement.xpReward;
      newAchievements.push(definition.name);
    }

    let user = await transaction.user.update({
      where: { id: ownerId },
      data: {
        xp: { increment: xpAwarded + achievementXpAwarded },
        lastActiveAt: activityAt,
      },
      select: { xp: true, level: true },
    });
    const level = levelForXp(user.xp);
    if (user.level !== level) {
      user = await transaction.user.update({
        where: { id: ownerId },
        data: { level },
        select: { xp: true, level: true },
      });
    }

    return {
      interactionId: interaction.id,
      contactId: interaction.contactId,
      type: interaction.type,
      title: interaction.title,
      occurredAt: interaction.occurredAt,
      xpAwarded: interaction.xpEarned,
      totalXp: user.xp,
      level: user.level,
      newAchievements,
    };
  }

  private toAgentResult(result: InteractionWriteResult): AgentInteractionResult {
    return {
      interactionId: result.interactionId,
      contactId: result.contactId,
      type: result.type,
      occurredAt: result.occurredAt,
      xpAwarded: result.xpAwarded,
      totalXp: result.totalXp,
      level: result.level,
    };
  }
}
