/**
 * Enrichment Agent
 *
 * Legacy completeness reporter.
 *
 * Evidence collection, candidate persistence, and missing-only application live
 * in ContactEnrichmentService and the scoped MCP tools. This class deliberately
 * has no external enrichment integration or direct-apply path.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AgentContext, AgentResult, EnrichmentResult } from '../agents/types.js';

@Injectable()
export class EnrichmentAgent {
  constructor(private prisma: PrismaService) {}

  /**
   * Report enrichment completeness for a single contact.
   */
  async enrichContact(
    ctx: AgentContext,
  ): Promise<AgentResult<EnrichmentResult>> {
    if (!ctx.contactId) {
      return {
        success: false,
        agent: 'enrichment' as any,
        error: 'contactId is required for enrichment',
        executedAt: new Date(),
      };
    }

    try {
      const contact = await this.prisma.contact.findFirst({
        where: { id: ctx.contactId, ownerId: ctx.userId },
      });

      if (!contact) {
        return {
          success: false,
          agent: 'enrichment' as any,
          error: 'Contact not found',
          executedAt: new Date(),
        };
      }

      const enriched: EnrichmentResult['enriched'] = {};
      const sources: string[] = [];
      let confidence = 0;

      // Calculate confidence based on how complete the contact is
      const fields = [contact.bio, contact.company, contact.jobTitle, contact.photo, contact.socialLinks];
      const filledFields = fields.filter(f => f && (!Array.isArray(f) || f.length > 0));
      confidence = filledFields.length / fields.length;

      // Check if we already have good data
      if (confidence >= 0.8) {
        sources.push('existing');
      }

      return {
        success: true,
        agent: 'enrichment' as any,
        data: {
          contactId: ctx.contactId,
          enriched,
          confidence,
          sources,
        },
        executedAt: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        agent: 'enrichment' as any,
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt: new Date(),
      };
    }
  }

  /**
   * Batch enrichment for multiple contacts
   */
  async enrichContacts(
    ctx: AgentContext,
    options: { contactIds?: string[]; limit?: number } = {},
  ): Promise<AgentResult<EnrichmentResult[]>> {
    const { limit = 50 } = options;

    try {
      let contacts;
      if (options.contactIds && options.contactIds.length > 0) {
        contacts = await this.prisma.contact.findMany({
          where: {
            id: { in: options.contactIds },
            ownerId: ctx.userId,
          },
        });
      } else {
        contacts = await this.prisma.contact.findMany({
          where: { ownerId: ctx.userId },
          take: limit,
        });
      }

      const results: EnrichmentResult[] = [];

      for (const contact of contacts) {
        // Calculate current completeness
        const fields = [contact.bio, contact.company, contact.jobTitle, contact.photo, contact.socialLinks];
        const filledFields = fields.filter(f => f && (!Array.isArray(f) || f.length > 0));
        const confidence = filledFields.length / fields.length;

        results.push({
          contactId: contact.id,
          enriched: {},
          confidence,
          sources: confidence >= 0.8 ? ['existing'] : [],
        });
      }

      return {
        success: true,
        agent: 'enrichment' as any,
        data: results,
        executedAt: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        agent: 'enrichment' as any,
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt: new Date(),
      };
    }
  }

  /**
   * Apply enrichment data to a contact
   */
  async applyEnrichment(
    ctx: AgentContext,
    data: Partial<{
      photo: string;
      bio: string;
      company: string;
      jobTitle: string;
      socialLinks: Record<string, string>;
    }>,
  ): Promise<AgentResult<{ updated: boolean }>> {
    if (!ctx.contactId) {
      return {
        success: false,
        agent: 'enrichment' as any,
        error: 'contactId is required',
        executedAt: new Date(),
      };
    }

    void data;
    return {
      success: false,
      agent: 'enrichment' as any,
      error:
        'Direct enrichment application is disabled; submit an evidence-backed candidate instead',
      executedAt: new Date(),
    };
  }
}
