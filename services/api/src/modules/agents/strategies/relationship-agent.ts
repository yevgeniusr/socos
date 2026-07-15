/**
 * Relationship Agent
 *
 * Tracks contacts that need attention based on:
 * - Time since last interaction
 * - Relationship score decay
 * - Upcoming important dates
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  AgentContext,
  AgentResult,
  RelationshipRecommendation,
} from '../agents/types.js';

@Injectable()
export class RelationshipAgent {
  constructor(private prisma: PrismaService) {}

  /**
   * Get contacts that need attention - sorted by priority
   * Priority is determined by days since last contact and relationship score
   */
  async getRecommendations(
    ctx: AgentContext,
    options: { daysStale?: number; limit?: number } = {},
  ): Promise<AgentResult<RelationshipRecommendation[]>> {
    const { daysStale = 14, limit = 20 } = options;

    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - daysStale);

    try {
      const contacts = await this.prisma.contact.findMany({
        where: {
          ownerId: ctx.userId,
          isDemo: false,
          OR: [
            { lastContactedAt: { lt: staleDate } },
            {
              lastContactedAt: null,
              createdAt: { lt: staleDate },
            },
          ],
        },
        include: {
          _count: {
            select: { interactions: true },
          },
        },
        orderBy: { lastContactedAt: 'asc' },
        take: limit,
      });

      const recommendations: RelationshipRecommendation[] = contacts.map(
        (contact) => {
          const daysSinceContact = contact.lastContactedAt
            ? Math.floor(
                (Date.now() - contact.lastContactedAt.getTime()) /
                  (1000 * 60 * 60 * 24),
              )
            : Math.floor(
                (Date.now() - contact.createdAt.getTime()) /
                  (1000 * 60 * 60 * 24),
              );

          // Determine priority based on days since contact and relationship score
          let priority: 'high' | 'medium' | 'low';
          if (daysSinceContact > 60 || contact.relationshipScore < 30) {
            priority = 'high';
          } else if (daysSinceContact > 30 || contact.relationshipScore < 50) {
            priority = 'medium';
          } else {
            priority = 'low';
          }

          return {
            contactId: contact.id,
            contactName: `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`,
            reason: this.getReason(daysSinceContact, contact.relationshipScore),
            priority,
            daysSinceContact,
            suggestedAction: this.getSuggestedAction(contact, daysSinceContact),
          };
        },
      );

      return {
        success: true,
        agent: 'relationship' as any,
        data: recommendations,
        executedAt: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        agent: 'relationship' as any,
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt: new Date(),
      };
    }
  }

  /**
   * Update relationship scores based on interaction patterns
   */
  async refreshScores(userId: string): Promise<AgentResult<{ updated: number }>> {
    try {
      const contacts = await this.prisma.contact.findMany({
        where: { ownerId: userId, isDemo: false },
        include: {
          interactions: {
            orderBy: { occurredAt: 'desc' },
            take: 10,
          },
        },
      });

      let updated = 0;
      for (const contact of contacts) {
        const lastInteraction = contact.interactions[0];
        const interactionCount = contact.interactions.length;

        // Simple scoring algorithm:
        // Base score of 50, +10 for recent interaction, -5 for each 30 days stale
        let newScore = 50;

        if (lastInteraction) {
          const daysSince = Math.floor(
            (Date.now() - lastInteraction.occurredAt.getTime()) /
              (1000 * 60 * 60 * 24),
          );

          if (daysSince <= 7) newScore += 30;
          else if (daysSince <= 14) newScore += 20;
          else if (daysSince <= 30) newScore += 10;
          else newScore -= Math.min(30, Math.floor(daysSince / 30) * 5);
        }

        // Boost for consistent interactions
        if (interactionCount >= 10) newScore += 10;
        else if (interactionCount >= 5) newScore += 5;

        newScore = Math.max(0, Math.min(100, newScore));

        if (newScore !== contact.relationshipScore) {
          await this.prisma.contact.update({
            where: { id: contact.id },
            data: { relationshipScore: newScore },
          });
          updated++;
        }
      }

      return {
        success: true,
        agent: 'relationship' as any,
        data: { updated },
        executedAt: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        agent: 'relationship' as any,
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt: new Date(),
      };
    }
  }

  private getReason(daysSinceContact: number, relationshipScore: number): string {
    if (daysSinceContact > 60) {
      return `You haven't connected in ${daysSinceContact} days. Time for a check-in!`;
    }
    if (relationshipScore < 30) {
      return 'Your relationship score is low. A meaningful interaction could help.';
    }
    if (daysSinceContact > 30) {
      return `It's been ${daysSinceContact} days. Consider reaching out.`;
    }
    return 'Regular check-ins help maintain strong relationships.';
  }

  private getSuggestedAction(
    contact: {
      firstName: string;
      lastName?: string | null;
      company?: string | null;
      birthday?: Date | null;
    },
    daysSinceContact: number,
  ): string {
    const name = contact.firstName;
    if (contact.company && daysSinceContact > 30) {
      return `Send a message asking about their work at ${contact.company}`;
    }
    if (contact.birthday) {
      return `Check in around their birthday coming up`;
    }
    return daysSinceContact > 60
      ? `Send a thoughtful message to reconnect`
      : `Schedule a quick call or coffee`;
  }
}
