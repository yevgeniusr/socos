/**
 * Summary Agent
 *
 * Generates AI summaries of:
 * - Individual interactions
 * - Contact history (overall relationship summary)
 * - Time periods (weekly/monthly check-ins)
 *
 * Uses Anthropic Claude for LLM-powered summarization when ANTHROPIC_API_KEY is configured.
 * Falls back to rule-based summaries in development.
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmService } from '../../llm/llm.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AgentContext, AgentResult, SummaryResult } from '../agents/types.js';

@Injectable()
export class SummaryAgent {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  /**
   * Generate a summary for a single interaction
   */
  async summarizeInteraction(
    ctx: AgentContext,
  ): Promise<AgentResult<SummaryResult>> {
    if (!ctx.interactionId) {
      return {
        success: false,
        agent: 'summary' as any,
        error: 'interactionId is required',
        executedAt: new Date(),
      };
    }

    try {
      const interaction = await this.prisma.interaction.findFirst({
        where: {
          id: ctx.interactionId,
          ownerId: ctx.userId,
          contact: { isDemo: false },
        },
        include: { contact: true },
      });

      if (!interaction) {
        return {
          success: false,
          agent: 'summary' as any,
          error: 'Interaction not found',
          executedAt: new Date(),
        };
      }

      // Try Anthropic API for LLM-powered summary, fall back to template
      const summary = await this.llmSummarizeInteraction(
        interaction.content,
        interaction.type,
        interaction.contact.firstName,
      );

      return {
        success: true,
        agent: 'summary' as any,
        data: {
          interactionId: interaction.id,
          contactId: interaction.contactId,
          summary,
          keyTopics: this.extractTopics(interaction.content),
          actionItems: this.extractActionItems(interaction.content),
          sentiment: this.analyzeSentiment(interaction.content),
        },
        executedAt: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        agent: 'summary' as any,
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt: new Date(),
      };
    }
  }

  /**
   * Generate a summary of all interactions with a contact
   */
  async summarizeContactHistory(
    ctx: AgentContext,
    options: { limit?: number; daysBack?: number } = {},
  ): Promise<AgentResult<SummaryResult>> {
    if (!ctx.contactId) {
      return {
        success: false,
        agent: 'summary' as any,
        error: 'contactId is required',
        executedAt: new Date(),
      };
    }

    const { limit = 50, daysBack = 90 } = options;

    try {
      const contact = await this.prisma.contact.findFirst({
        where: { id: ctx.contactId, ownerId: ctx.userId, isDemo: false },
      });

      if (!contact) {
        return {
          success: false,
          agent: 'summary' as any,
          error: 'Contact not found',
          executedAt: new Date(),
        };
      }

      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - daysBack);

      const interactions = await this.prisma.interaction.findMany({
        where: {
          contactId: ctx.contactId,
          ownerId: ctx.userId,
          occurredAt: { gte: sinceDate },
        },
        orderBy: { occurredAt: 'desc' },
        take: limit,
      });

      // Try Anthropic API for LLM-powered contact summary, fall back to template
      const allContent = interactions.map(i => i.content || i.title).filter(Boolean).join(' ');
      const summary = await this.llmSummarizeContact(
        allContent,
        interactions,
        contact,
        daysBack,
      );

      return {
        success: true,
        agent: 'summary' as any,
        data: {
          contactId: ctx.contactId,
          summary,
          keyTopics: this.extractTopics(allContent),
          actionItems: [],
          sentiment: this.analyzeSentiment(allContent),
        },
        executedAt: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        agent: 'summary' as any,
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt: new Date(),
      };
    }
  }

  /**
   * Generate weekly/monthly activity summary
   */
  async summarizeActivityPeriod(
    ctx: AgentContext,
    options: { period?: 'week' | 'month' } = {},
  ): Promise<AgentResult<SummaryResult>> {
    const { period = 'week' } = options;
    const days = period === 'week' ? 7 : 30;

    try {
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - days);

      const [interactions, newContacts, remindersCompleted] = await Promise.all([
        this.prisma.interaction.findMany({
          where: {
            ownerId: ctx.userId,
            occurredAt: { gte: sinceDate },
            contact: { isDemo: false },
          },
          include: { contact: { select: { firstName: true, lastName: true } } },
          orderBy: { occurredAt: 'desc' },
        }),
        this.prisma.contact.count({
          where: {
            ownerId: ctx.userId,
            createdAt: { gte: sinceDate },
            isDemo: false,
          },
        }),
        this.prisma.reminder.count({
          where: {
            ownerId: ctx.userId,
            status: 'completed',
            completedAt: { gte: sinceDate },
            contact: { isDemo: false },
          },
        }),
      ]);

      const contactNames = [...new Set(interactions.map(i => i.contact.firstName))];
      const summary = `Over the past ${period}, you had ${interactions.length} interactions with ${contactNames.length} contacts. You added ${newContacts} new contact${newContacts !== 1 ? 's' : ''} and completed ${remindersCompleted} reminder${remindersCompleted !== 1 ? 's' : ''}.`;

      return {
        success: true,
        agent: 'summary' as any,
        data: {
          contactId: '', // No specific contact
          summary,
          keyTopics: this.extractTopics(interactions.map(i => i.content || '').join(' ')),
          actionItems: [],
          sentiment: 'neutral',
        },
        executedAt: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        agent: 'summary' as any,
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt: new Date(),
      };
    }
  }

  // ========== Helper Methods ==========

  private generateSimpleSummary(
    content: string | null,
    type: string,
  ): string {
    if (!content) {
      return `${type.charAt(0).toUpperCase() + type.slice(1)} interaction logged.`;
    }

    // Simple truncation + cleanup as placeholder
    const truncated =
      content.length > 500 ? content.substring(0, 497) + '...' : content;
    return truncated;
  }

  private generateContactSummary(
    contact: { firstName: string; lastName?: string | null },
    interactions: Array<{ type: string; content?: string | null }>,
    daysBack: number,
  ): string {
    const name = `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`;
    const count = interactions.length;

    if (count === 0) {
      return `No interactions with ${name} in the last ${daysBack} days.`;
    }

    const typeCounts = interactions.reduce((acc, i) => {
      acc[i.type] = (acc[i.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const types = Object.entries(typeCounts)
      .map(([type, count]) => `${count} ${type}`)
      .join(', ');

    return `You've had ${count} interaction${count !== 1 ? 's' : ''} with ${name} over the past ${daysBack} days: ${types}.`;
  }

  private extractTopics(content: string): string[] {
    if (!content) return [];

    // Simple keyword extraction (placeholder for LLM-based extraction)
    const words = content.toLowerCase().split(/\s+/);
    const topics: string[] = [];

    const keywords = [
      'meeting', 'project', 'work', 'family', 'travel', 'birthday',
      'celebration', 'dinner', 'lunch', 'coffee', 'call', 'email',
      'conference', 'feedback', 'update', 'news', 'newsletter',
    ];

    for (const keyword of keywords) {
      if (words.some(w => w.includes(keyword))) {
        topics.push(keyword);
      }
    }

    return [...new Set(topics)].slice(0, 5);
  }

  private extractActionItems(content: string): string[] {
    if (!content) return [];

    // Simple action item detection (placeholder for LLM-based extraction)
    const actionPatterns = [
      /(?:will|should|need to|going to)\s+([^.!?]+)/gi,
      /^-?\s*([^.!?]+)$/gm,
    ];

    const items: string[] = [];
    for (const pattern of actionPatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) items.push(match[1].trim());
      }
    }

    return items.slice(0, 5);
  }

  private analyzeSentiment(
    content: string,
  ): 'positive' | 'neutral' | 'negative' {
    if (!content) return 'neutral';

    const positive = [
      'great', 'good', 'excellent', 'amazing', 'wonderful', 'fantastic',
      'happy', 'excited', 'love', 'enjoy', 'appreciate', 'thanks',
    ];
    const negative = [
      'bad', 'terrible', 'awful', 'poor', 'disappointed', 'frustrated',
      'upset', 'angry', 'sad', 'unhappy', 'concern', 'worry',
    ];

    const words = content.toLowerCase().split(/\s+/);
    let score = 0;

    for (const word of words) {
      if (positive.some(p => word.includes(p))) score++;
      if (negative.some(n => word.includes(n))) score--;
    }

    if (score > 1) return 'positive';
    if (score < -1) return 'negative';
    return 'neutral';
  }

  /**
   * LLM-powered single interaction summary via OpenRouter.
   * Falls back to template-based summary when API key is not configured.
   */
  private async llmSummarizeInteraction(
    content: string | null,
    type: string,
    contactName: string,
  ): Promise<string> {
    if (!content) {
      return this.generateSimpleSummary(content, type);
    }

    const llm = new LlmService(this.configService);

    if (!llm.isConfigured) {
      return this.generateSimpleSummary(content, type);
    }

    const prompt = `Summarize the following interaction with ${contactName} in 2-3 sentences.
Focus on what was discussed, any decisions made, and follow-up items.

Interaction type: ${type}
Content: "${content}"

Provide a concise, human-readable summary suitable for a personal CRM.`;

    try {
      const result = await llm.complete(prompt, { maxTokens: 512 });
      return result ?? this.generateSimpleSummary(content, type);
    } catch (error) {
      console.error('[SummaryAgent] LLM error:', error instanceof Error ? error.message : error);
      return this.generateSimpleSummary(content, type);
    }
  }

  /**
   * LLM-powered contact history summary via OpenRouter.
   * Falls back to template-based summary when API key is not configured.
   */
  private async llmSummarizeContact(
    allContent: string,
    interactions: Array<{ type: string; content?: string | null; occurredAt: Date }>,
    contact: { firstName: string; lastName?: string | null },
    daysBack: number,
  ): Promise<string> {
    const name = `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`;

    if (!allContent) {
      return this.generateContactSummary(contact, interactions, daysBack);
    }

    const llm = new LlmService(this.configService);

    if (!llm.isConfigured) {
      return this.generateContactSummary(contact, interactions, daysBack);
    }

    const typeCounts = interactions.reduce((acc, i) => {
      acc[i.type] = (acc[i.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const typeSummary = Object.entries(typeCounts)
      .map(([type, count]) => `${count} ${type}`)
      .join(', ');

    const prompt = `Generate a relationship summary for ${name} based on the last ${daysBack} days of interactions.
Interaction types: ${typeSummary}

Recent interactions:
${allContent.substring(0, 2000)}

Write a 2-3 paragraph summary that:
1. Captures the overall tone and frequency of interactions
2. Notes any important themes or topics discussed
3. Highlights the current state of the relationship

Keep it personal and warm, suitable for a CRM.`;

    try {
      const result = await llm.complete(prompt, { maxTokens: 768 });
      return result ?? this.generateContactSummary(contact, interactions, daysBack);
    } catch (error) {
      console.error('[SummaryAgent] LLM contact summary error:', error instanceof Error ? error.message : error);
      return this.generateContactSummary(contact, interactions, daysBack);
    }
  }
}
