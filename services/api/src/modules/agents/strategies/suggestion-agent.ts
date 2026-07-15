/**
 * Suggestion Agent
 *
 * Recommends people to meet based on:
 * - Shared interests / tags
 * - Mutual connections
 * - Recent activity patterns
 * - Location proximity
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AgentContext, AgentResult, SuggestionResult } from '../agents/types.js';

@Injectable()
export class SuggestionAgent {
  constructor(private prisma: PrismaService) {}

  /**
   * Get suggested contacts to meet based on interests matching
   */
  async getSuggestions(
    ctx: AgentContext,
    options: { limit?: number; reason?: 'interests' | 'mutual' | 'stale' | 'nearby' } = {},
  ): Promise<AgentResult<SuggestionResult[]>> {
    const { limit = 10 } = options;

    try {
      const currentUser = await this.prisma.user.findUnique({
        where: { id: ctx.userId },
        include: {
          contacts: {
            where: { isDemo: false },
            include: {
              interactions: {
                orderBy: { occurredAt: 'desc' },
                take: 5,
              },
            },
            take: 50,
          },
        },
      });

      if (!currentUser) {
        return {
          success: false,
          agent: 'suggestion' as any,
          error: 'User not found',
          executedAt: new Date(),
        };
      }

      const suggestions: SuggestionResult[] = [];

      // Algorithm: Find contacts with overlapping tags/interests
      // and suggest meeting those with shared interests the user hasn't
      // interacted with recently

      for (const contact of currentUser.contacts) {
        if (contact.lastContactedAt) {
          const daysSince = Math.floor(
            (Date.now() - contact.lastContactedAt.getTime()) / (1000 * 60 * 60 * 24),
          );

          // Skip recently contacted
          if (daysSince < 14) continue;
        }

        const tags = contact.tags || [];
        const labels = contact.labels || [];

        if (tags.length === 0 && labels.length === 0) continue;

        // Find other contacts with overlapping tags
        const similarContacts = currentUser.contacts.filter((c) => {
          if (c.id === contact.id) return false;
          if (!c.lastContactedAt) return false;

          const daysSince = Math.floor(
            (Date.now() - c.lastContactedAt.getTime()) / (1000 * 60 * 60 * 24),
          );
          if (daysSince < 14) return false;

          const cTags = c.tags || [];
          const cLabels = c.labels || [];

          return tags.some((t) => cTags.includes(t)) ||
                 labels.some((l) => cLabels.includes(l));
        });

        if (similarContacts.length > 0) {
          const sharedInterests = [
            ...new Set([
              ...tags.filter((t) => similarContacts.some((c) => c.tags.includes(t))),
              ...labels.filter((l) => similarContacts.some((c) => c.labels.includes(l))),
            ]),
          ];

          suggestions.push({
            contactId: contact.id,
            contactName: `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`,
            reason: `Shares interests in: ${sharedInterests.join(', ')}`,
            score: sharedInterests.length * 10 + (contact.relationshipScore || 50),
            sharedInterests,
          });
        }
      }

      // Sort by score and return top N
      suggestions.sort((a, b) => b.score - a.score);

      return {
        success: true,
        agent: 'suggestion' as any,
        data: suggestions.slice(0, limit),
        executedAt: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        agent: 'suggestion' as any,
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt: new Date(),
      };
    }
  }

  /**
   * Suggest warm introductions between contacts
   */
  async suggestIntroductions(
    ctx: AgentContext,
    options: { limit?: number } = {},
  ): Promise<AgentResult<Array<{ person1: string; person2: string; reason: string }>>> {
    const { limit = 10 } = options;

    try {
      const contacts = await this.prisma.contact.findMany({
        where: { ownerId: ctx.userId, isDemo: false },
        include: {
          interactions: {
            include: {
              contact: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          },
        },
      });

      // Find contacts that both have interacted with the same person
      // but haven't interacted with each other
      const introductions: Array<{ person1: string; person2: string; reason: string }> = [];

      for (const contact of contacts) {
        const interactionPartners = new Set(
          contact.interactions
            .map((i) => i.contact.id)
            .filter((id) => id !== contact.id),
        );

        for (const partnerId of interactionPartners) {
          const partner = contacts.find((c) => c.id === partnerId);
          if (!partner) continue;

          // Check if they haven't interacted
          const partnerInteracted = partner.interactions.some((i) =>
            i.contact.id === contact.id,
          );
          if (partnerInteracted) continue;

          // Check if this introduction already exists
          const exists = introductions.some(
            (intro) =>
              (intro.person1 === contact.id && intro.person2 === partnerId) ||
              (intro.person1 === partnerId && intro.person2 === contact.id),
          );
          if (exists) continue;

          introductions.push({
            person1: contact.id,
            person2: partnerId,
            reason: `Both have interacted with ${contact.firstName} but haven't met each other`,
          });
        }
      }

      return {
        success: true,
        agent: 'suggestion' as any,
        data: introductions.slice(0, limit),
        executedAt: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        agent: 'suggestion' as any,
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt: new Date(),
      };
    }
  }

  /**
   * Get contacts suggested based on relationship score improvement potential
   */
  async suggestScoreImprovement(
    ctx: AgentContext,
    options: { limit?: number } = {},
  ): Promise<AgentResult<SuggestionResult[]>> {
    const { limit = 10 } = options;

    try {
      const contacts = await this.prisma.contact.findMany({
        where: {
          ownerId: ctx.userId,
          isDemo: false,
          relationshipScore: { lt: 50 },
        },
        include: {
          _count: { select: { interactions: true } },
        },
        orderBy: { relationshipScore: 'asc' },
        take: limit,
      });

      const suggestions: SuggestionResult[] = contacts.map((contact) => {
        const interactionCount = contact._count.interactions;
        let reason = '';
        let score = 50 - (contact.relationshipScore || 0);

        if (interactionCount === 0) {
          reason = 'New contact - reach out to start the relationship';
        } else if (interactionCount < 3) {
          reason = 'Few interactions - a couple more would help';
        } else {
          reason = 'Relationship score could be improved with quality interactions';
        }

        // Boost score based on recency of last interaction
        if (contact.lastContactedAt) {
          const daysSince = Math.floor(
            (Date.now() - contact.lastContactedAt.getTime()) / (1000 * 60 * 60 * 24),
          );
          if (daysSince > 30) score += 20;
          else if (daysSince > 14) score += 10;
        }

        return {
          contactId: contact.id,
          contactName: `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`,
          reason,
          score,
          sharedInterests: contact.tags || [],
        };
      });

      return {
        success: true,
        agent: 'suggestion' as any,
        data: suggestions,
        executedAt: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        agent: 'suggestion' as any,
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt: new Date(),
      };
    }
  }
}
