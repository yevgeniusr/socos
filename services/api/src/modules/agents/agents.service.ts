/**
 * AI Agent System - Main Service
 *
 * Orchestrates all AI agents and provides a unified interface.
 * Each agent handles a specific responsibility:
 * - relationship: Who to reach out to
 * - reminder: Birthday, anniversary, follow-up reminders
 * - enrichment: Auto-fill contact info
 * - summary: Generate interaction summaries
 * - suggestion: Recommend people to meet
 */

import { Injectable } from '@nestjs/common';
import { RelationshipAgent } from './strategies/relationship-agent.js';
import { ReminderAgent } from './strategies/reminder-agent.js';
import { EnrichmentAgent } from './strategies/enrichment-agent.js';
import { SummaryAgent } from './strategies/summary-agent.js';
import { SuggestionAgent } from './strategies/suggestion-agent.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  AgentContext,
  AgentType,
  AgentResult,
  RelationshipRecommendation,
  ReminderRecommendation,
  EnrichmentResult,
  SummaryResult,
  SuggestionResult,
} from './agents/types.js';

@Injectable()
export class AgentsService {
  constructor(
    private relationshipAgent: RelationshipAgent,
    private reminderAgent: ReminderAgent,
    private enrichmentAgent: EnrichmentAgent,
    private summaryAgent: SummaryAgent,
    private suggestionAgent: SuggestionAgent,
    private prisma: PrismaService,
  ) {}

  /**
   * Route agent request to the appropriate agent
   */
  async route(
    ctx: AgentContext,
    agent: AgentType,
    options?: any,
  ): Promise<AgentResult<any>> {
    switch (agent) {
      case AgentType.RELATIONSHIP:
        return this.relationshipAgent.getRecommendations(ctx, options || {});
      case AgentType.REMINDER:
        return this.reminderAgent.getUpcomingReminders(ctx, options || {});
      case AgentType.ENRICHMENT:
        return this.enrichmentAgent.enrichContact(ctx);
      case AgentType.SUMMARY:
        return this.summaryAgent.summarizeContactHistory(ctx, options || {});
      case AgentType.SUGGESTION:
        return this.suggestionAgent.getSuggestions(ctx, options || {});
      default:
        return {
          success: false,
          agent,
          error: `Unknown agent type: ${agent}`,
          executedAt: new Date(),
        };
    }
  }

  // ========== Convenience Methods ==========

  async getRelationshipRecommendations(
    ctx: AgentContext,
    options?: { daysStale?: number; limit?: number },
  ): Promise<AgentResult<RelationshipRecommendation[]>> {
    return this.relationshipAgent.getRecommendations(ctx, options || {});
  }

  async refreshRelationshipScores(
    ctx: AgentContext,
  ): Promise<AgentResult<{ updated: number }>> {
    return this.relationshipAgent.refreshScores(ctx.userId);
  }

  async getReminderRecommendations(
    ctx: AgentContext,
    options?: { daysAhead?: number; types?: string[] },
  ): Promise<AgentResult<ReminderRecommendation[]>> {
    return this.reminderAgent.getUpcomingReminders(ctx, options || {});
  }

  async suggestBirthdayReminders(
    ctx: AgentContext,
    options?: { daysAhead?: number },
  ): Promise<AgentResult<ReminderRecommendation[]>> {
    return this.reminderAgent.suggestBirthdayReminders(ctx, options || {});
  }

  async suggestStaleContactReminders(
    ctx: AgentContext,
    options?: { staleDays?: number; limit?: number },
  ): Promise<AgentResult<ReminderRecommendation[]>> {
    return this.reminderAgent.suggestStaleContactReminders(ctx, options || {});
  }

  async syncCelebrationReminders(
    ctx: AgentContext,
  ): Promise<AgentResult<{ created: number; existing: number }>> {
    return this.reminderAgent.syncCelebrationReminders(ctx);
  }

  async enrichContact(
    ctx: AgentContext,
  ): Promise<AgentResult<EnrichmentResult>> {
    return this.enrichmentAgent.enrichContact(ctx);
  }

  async enrichContacts(
    ctx: AgentContext,
    options?: { contactIds?: string[]; limit?: number },
  ): Promise<AgentResult<EnrichmentResult[]>> {
    return this.enrichmentAgent.enrichContacts(ctx, options || {});
  }

  async applyEnrichment(
    ctx: AgentContext,
    data: Parameters<typeof this.enrichmentAgent.applyEnrichment>[1] extends infer T ? T : never,
  ): Promise<AgentResult<{ updated: boolean }>> {
    return this.enrichmentAgent.applyEnrichment(ctx, data);
  }

  async summarizeInteraction(
    ctx: AgentContext,
  ): Promise<AgentResult<SummaryResult>> {
    return this.summaryAgent.summarizeInteraction(ctx);
  }

  async summarizeContactHistory(
    ctx: AgentContext,
    options?: { limit?: number; daysBack?: number },
  ): Promise<AgentResult<SummaryResult>> {
    return this.summaryAgent.summarizeContactHistory(ctx, options || {});
  }

  async summarizeActivityPeriod(
    ctx: AgentContext,
    options?: { period?: 'week' | 'month' },
  ): Promise<AgentResult<SummaryResult>> {
    return this.summaryAgent.summarizeActivityPeriod(ctx, options || {});
  }

  async getSuggestions(
    ctx: AgentContext,
    options?: { limit?: number; reason?: 'interests' | 'mutual' | 'stale' | 'nearby' },
  ): Promise<AgentResult<SuggestionResult[]>> {
    return this.suggestionAgent.getSuggestions(ctx, options || {});
  }

  async suggestIntroductions(
    ctx: AgentContext,
    options?: { limit?: number },
  ): Promise<AgentResult<any[]>> {
    return this.suggestionAgent.suggestIntroductions(ctx, options || {});
  }

  async suggestScoreImprovement(
    ctx: AgentContext,
    options?: { limit?: number },
  ): Promise<AgentResult<SuggestionResult[]>> {
    return this.suggestionAgent.suggestScoreImprovement(ctx, options || {});
  }

  /**
   * Run all agents and return comprehensive dashboard data
   */
  async getDashboard(
    ctx: AgentContext,
  ): Promise<AgentResult<{
    relationship: RelationshipRecommendation[];
    reminders: ReminderRecommendation[];
    suggestions: SuggestionResult[];
    stats: {
      totalContacts: number;
      contactsNeedingAttention: number;
      upcomingReminders: number;
    };
  }>> {
    try {
      const [relationship, reminders, suggestions, contactCount] = await Promise.all([
        this.relationshipAgent.getRecommendations(ctx, { limit: 10 }),
        this.reminderAgent.getUpcomingReminders(ctx, { daysAhead: 14 }),
        this.suggestionAgent.getSuggestions(ctx, { limit: 5 }),
        this.prisma.contact.count({
          where: { ownerId: ctx.userId, isDemo: false },
        }),
      ]);

      return {
        success: true,
        agent: 'relationship' as any,
        data: {
          relationship: relationship.data || [],
          reminders: reminders.data || [],
          suggestions: suggestions.data || [],
          stats: {
            totalContacts: contactCount,
            contactsNeedingAttention: (relationship.data || []).length,
            upcomingReminders: (reminders.data || []).length,
          },
        },
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
}
