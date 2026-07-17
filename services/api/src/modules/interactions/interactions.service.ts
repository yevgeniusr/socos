import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { GamificationService } from '../gamification/gamification.service.js';
import type { InteractionRewardNotifications } from '../gamification/gamification.service.js';
import { HumanIdempotencyService } from '../../common/human-idempotency.service.js';
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

export interface InteractionReceiptEnvelope {
  interaction: {
    id: string;
    contactId: string;
    type: string;
    title: string | null;
    content: string | null;
    summary: string | null;
    occurredAt: string;
    duration: number | null;
    location: string | null;
    xpEarned: number;
    createdAt: string;
  };
  lastContact: {
    previousAt: string | null;
    resultingAt: string | null;
    advanced: boolean;
  };
  xp: {
    interactionDelta: number;
    achievementDelta: number;
    totalDelta: number;
    totalAfter: number;
    levelAfter: number;
  };
  outcome: "Recorded only; nothing sent";
  createdAt: string;
}

export type AgentInteractionResult = InteractionReceiptEnvelope;

interface InteractionWriteResult {
  receipt: InteractionReceiptEnvelope;
  newAchievements: string[];
  rewardNotifications: InteractionRewardNotifications;
}

interface PersistedInteractionReceipt {
  previousLastContactedAt: Date | null;
  resultingLastContactedAt: Date | null;
  lastContactAdvanced: boolean;
  interactionXpDelta: number;
  achievementXpDelta: number;
  totalXpDelta: number;
  totalXpAfter: number;
  levelAfter: number;
  createdAt: Date;
  interaction: {
    id: string;
    contactId: string;
    type: string;
    title: string | null;
    content: string | null;
    summary: string | null;
    occurredAt: Date;
    duration: number | null;
    location: string | null;
    xpEarned: number;
    createdAt: Date;
  };
}

const RECORDED_ONLY_OUTCOME = "Recorded only; nothing sent" as const;

const INTERACTION_RECEIPT_SELECT = {
  previousLastContactedAt: true,
  resultingLastContactedAt: true,
  lastContactAdvanced: true,
  interactionXpDelta: true,
  achievementXpDelta: true,
  totalXpDelta: true,
  totalXpAfter: true,
  levelAfter: true,
  createdAt: true,
  interaction: {
    select: {
      id: true,
      contactId: true,
      type: true,
      title: true,
      content: true,
      summary: true,
      occurredAt: true,
      duration: true,
      location: true,
      xpEarned: true,
      createdAt: true,
    },
  },
} as const;

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
    @Optional() private humanIdempotencyService?: HumanIdempotencyService,
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
    return result.receipt;
  }

  async create(
    userId: string,
    dto: CreateInteractionDto,
    idempotencyKey?: string,
  ) {
    if (idempotencyKey === undefined) {
      const write = await this.prisma.$transaction(
        (tx) => this.createForAgentInTransaction(tx, userId, dto),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      this.notifyInteractionRewards(userId, write.rewardNotifications);
      return write.receipt;
    }
    if (!this.humanIdempotencyService) {
      throw new Error('Human idempotency service is unavailable.');
    }
    const result = await this.humanIdempotencyService.execute(
      userId,
      'interaction:create',
      idempotencyKey,
      dto,
      async (tx) => {
        const write = await this.createForAgentInTransaction(tx, userId, dto);
        return {
          receipt: write.receipt,
          rewardNotifications: write.rewardNotifications,
        };
      },
    );
    if (!result.replayed) {
      this.notifyInteractionRewards(userId, result.value.rewardNotifications);
    }
    return result.value.receipt;
  }

  private notifyInteractionRewards(
    userId: string,
    rewardNotifications: InteractionRewardNotifications,
  ): void {
    void this.gamificationService
      .notifyInteractionRewards(userId, rewardNotifications)
      .catch((err) =>
        console.error('Failed to send interaction reward notifications:', err)
      );
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

  async getReceipt(
    userId: string,
    interactionId: string,
  ): Promise<InteractionReceiptEnvelope> {
    const receipt = await this.prisma.interactionReceipt.findFirst({
      where: { interactionId, ownerId: userId },
      select: INTERACTION_RECEIPT_SELECT,
    });
    if (!receipt) throw new NotFoundException('Interaction receipt not found');
    return this.toReceiptEnvelope(receipt);
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
        lastContactedAt: true,
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
        content: true,
        summary: true,
        occurredAt: true,
        duration: true,
        location: true,
        xpEarned: true,
        createdAt: true,
      },
    });

    const contactAdvance = await transaction.contact.updateMany({
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
    const achievementNotifications:
      InteractionRewardNotifications['achievements'] = [];
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
        select: {
          id: true,
          name: true,
          description: true,
          xpReward: true,
        },
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
      newAchievements.push(achievement.name);
      achievementNotifications.push({
        name: achievement.name,
        description: achievement.description,
        xpReward: achievement.xpReward,
      });
    }

    let user = await transaction.user.update({
      where: { id: ownerId },
      data: {
        xp: { increment: xpAwarded + achievementXpAwarded },
        lastActiveAt: activityAt,
      },
      select: { xp: true, level: true },
    });
    const previousLevel = user.level;
    const level = levelForXp(user.xp);
    if (user.level !== level) {
      user = await transaction.user.update({
        where: { id: ownerId },
        data: { level },
        select: { xp: true, level: true },
      });
    }

    const lastContactAdvanced = contactAdvance.count === 1;
    const resultingLastContactedAt = lastContactAdvanced
      ? interaction.occurredAt
      : contact.lastContactedAt;
    const totalXpDelta = interaction.xpEarned + achievementXpAwarded;
    const receipt = await transaction.interactionReceipt.create({
      data: {
        interactionId: interaction.id,
        ownerId,
        previousLastContactedAt: contact.lastContactedAt,
        resultingLastContactedAt,
        lastContactAdvanced,
        interactionXpDelta: interaction.xpEarned,
        achievementXpDelta: achievementXpAwarded,
        totalXpDelta,
        totalXpAfter: user.xp,
        levelAfter: user.level,
      },
      select: INTERACTION_RECEIPT_SELECT,
    });

    return {
      receipt: this.toReceiptEnvelope(receipt),
      newAchievements,
      rewardNotifications: {
        achievements: achievementNotifications,
        previousLevel,
        newLevel: user.level,
      },
    };
  }

  private toReceiptEnvelope(
    result: PersistedInteractionReceipt,
  ): InteractionReceiptEnvelope {
    return {
      interaction: {
        id: result.interaction.id,
        contactId: result.interaction.contactId,
        type: result.interaction.type,
        title: result.interaction.title,
        content: result.interaction.content,
        summary: result.interaction.summary,
        occurredAt: result.interaction.occurredAt.toISOString(),
        duration: result.interaction.duration,
        location: result.interaction.location,
        xpEarned: result.interaction.xpEarned,
        createdAt: result.interaction.createdAt.toISOString(),
      },
      lastContact: {
        previousAt: result.previousLastContactedAt?.toISOString() ?? null,
        resultingAt: result.resultingLastContactedAt?.toISOString() ?? null,
        advanced: result.lastContactAdvanced,
      },
      xp: {
        interactionDelta: result.interactionXpDelta,
        achievementDelta: result.achievementXpDelta,
        totalDelta: result.totalXpDelta,
        totalAfter: result.totalXpAfter,
        levelAfter: result.levelAfter,
      },
      outcome: RECORDED_ONLY_OUTCOME,
      createdAt: result.createdAt.toISOString(),
    };
  }
}
