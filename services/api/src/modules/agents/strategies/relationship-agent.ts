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
import {
  assessRelationship,
  type RelationshipHealth,
} from '../../briefs/relationship-health.js';

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

    const now = new Date();
    const staleDate = new Date(now);
    staleDate.setDate(staleDate.getDate() - daysStale);

    try {
      const contacts = await this.prisma.contact.findMany({
        where: {
          ownerId: ctx.userId,
          isDemo: false,
          OR: [
            { lastContactedAt: { lt: staleDate } },
            { lastContactedAt: null },
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
          const preferredCadenceDays = (
            contact as typeof contact & { preferredCadenceDays?: number }
          ).preferredCadenceDays ?? 90;
          const health = assessRelationship({
            now,
            lastContactedAt: contact.lastContactedAt,
            preferredCadenceDays,
          });
          const daysSinceContact = health.daysSinceContact ?? 0;

          let priority: 'high' | 'medium' | 'low';
          if (health.score < 30) {
            priority = 'high';
          } else if (health.score < 60) {
            priority = 'medium';
          } else {
            priority = 'low';
          }

          return {
            contactId: contact.id,
            contactName: `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`,
            reason: this.getReason(health),
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
      const now = new Date();
      const contacts = await this.prisma.contact.findMany({
        where: { ownerId: userId, isDemo: false },
      });

      let updated = 0;
      for (const contact of contacts) {
        if (contact.isDemo) continue;
        const preferredCadenceDays = (
          contact as typeof contact & { preferredCadenceDays?: number }
        ).preferredCadenceDays ?? 90;
        const newScore = assessRelationship({
          now,
          lastContactedAt: contact.lastContactedAt,
          preferredCadenceDays,
        }).score;

        if (newScore !== contact.relationshipScore) {
          const result = await this.prisma.contact.updateMany({
            where: {
              id: contact.id,
              ownerId: userId,
              isDemo: false,
            },
            data: { relationshipScore: newScore },
          });
          updated += result.count;
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

  private getReason(health: RelationshipHealth): string {
    if (health.reasonCode === 'never_contacted') {
      return 'No interaction has been recorded yet.';
    }
    if (health.reasonCode === 'cadence_overdue') {
      return `Preferred check-in cadence is overdue by ${health.daysOverdue} days.`;
    }
    if (health.reasonCode === 'cadence_due') {
      return 'Preferred check-in cadence is due today.';
    }
    return 'The relationship is within its preferred check-in cadence.';
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
