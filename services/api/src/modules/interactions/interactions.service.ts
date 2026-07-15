import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GamificationService } from '../gamification/gamification.service.js';
import { CreateInteractionDto, InteractionQueryDto } from './interactions.dto.js';

@Injectable()
export class InteractionsService {
  constructor(
    private prisma: PrismaService,
    private gamificationService: GamificationService,
  ) {}

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
}
