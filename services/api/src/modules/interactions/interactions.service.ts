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

  createForAgent(
    ownerId: string,
    input: AgentInteractionInput,
    transaction?: Prisma.TransactionClient
  ): Promise<AgentInteractionResult> {
    if (transaction) {
      return this.createForAgentInTransaction(transaction, ownerId, input);
    }
    return this.prisma.$transaction(
      (tx) => this.createForAgentInTransaction(tx, ownerId, input),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  }

  async create(userId: string, dto: CreateInteractionDto) {
    // Verify contact belongs to user
    const contact = await this.prisma.contact.findFirst({
      where: { id: dto.contactId, ownerId: userId },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const xpEarned = contact.isDemo
      ? 0
      : await this.gamificationService.calculateInteractionXp(dto.type);

    const interaction = await this.prisma.interaction.create({
      data: {
        contactId: dto.contactId,
        ownerId: userId,
        type: dto.type,
        title: dto.title,
        content: dto.content,
        summary: (dto as any).summary,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : new Date(),
        duration: dto.duration,
        location: dto.location,
        xpEarned,
      },
      include: {
        contact: {
          select: { id: true, firstName: true, lastName: true, photo: true },
        },
      },
    });

    const user = contact.isDemo
      ? await this.prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { xp: true, level: true },
        })
      : await this.prisma.user.update({
          where: { id: userId },
          data: {
            xp: { increment: xpEarned },
            lastActiveAt: new Date(),
          },
        });

    const levelInfo = contact.isDemo
      ? {
          newLevel: user.level,
          xpForNextLevel: Math.pow(user.level, 2) * 100,
        }
      : await this.gamificationService.checkLevelUp(userId, user.xp);

    // Update contact's lastContactedAt
    await this.prisma.contact.update({
      where: { id: dto.contactId },
      data: { lastContactedAt: new Date() },
    });

    const newAchievements = contact.isDemo
      ? []
      : await this.gamificationService.checkAchievements(userId);

    return {
      interaction: {
        id: interaction.id,
        type: interaction.type,
        title: interaction.title,
        occurredAt: interaction.occurredAt,
        xpEarned: interaction.xpEarned,
      },
      user: {
        xp: user.xp,
        level: levelInfo.newLevel,
        xpToNextLevel: levelInfo.xpForNextLevel,
      },
      newAchievements,
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
  ): Promise<AgentInteractionResult> {
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
      occurredAt: interaction.occurredAt,
      xpAwarded: interaction.xpEarned,
      totalXp: user.xp,
      level: user.level,
    };
  }
}
