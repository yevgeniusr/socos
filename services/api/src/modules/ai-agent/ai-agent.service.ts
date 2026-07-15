/**
 * AI Agent Service -- Core tool implementations
 *
 * Each public method is a "tool" callable via the action dispatcher.
 * Tools delegate to existing strategy agents and add structured reasoning.
 */

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service.js";
import { JwtService } from "../jwt/jwt.service.js";
import { AnthropicService } from "../llm/anthropic.service.js";
import { LlmService } from "../llm/llm.service.js";
import {
  AiAgentAction,
  AiAgentActionResponse,
  SuggestContactsResponse,
  SuggestedContact,
  ScheduleReminderResponse,
  SuggestedReminder,
  GenerateNoteResponse,
  GeneratedNote,
  AssessRelationshipHealthResponse,
  RelationshipAssessment,
} from "./ai-agent.dto.js";

export interface AgentContext {
  userId: string;
  vaultId?: string;
  contactId?: string;
}

@Injectable()
export class AiAgentService {
  private readonly anthropic: AnthropicService;
  private readonly llm: LlmService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    anthropicService: AnthropicService,
    llmService: LlmService,
  ) {
    this.anthropic = anthropicService;
    this.llm = llmService;
  }

  /**
   * Call LLM via Anthropic (direct), falling back to OpenRouter.
   * Returns null when no API key is configured.
   */
  private async callLlm(prompt: string, maxTokens = 512): Promise<string | null> {
    // Try Anthropic first (direct), then fall back to OpenRouter
    if (this.anthropic.isConfigured) {
      try {
        const result = await this.anthropic.complete(prompt, { maxTokens });
        if (result) return result;
      } catch (error) {
        console.error('[AiAgentService] Anthropic error:', error instanceof Error ? error.message : error);
      }
    }

    // Fall back to OpenRouter
    if (this.llm.isConfigured) {
      try {
        const result = await this.llm.complete(prompt, { maxTokens });
        return result;
      } catch (error) {
        console.error('[AiAgentService] OpenRouter error:', error instanceof Error ? error.message : error);
      }
    }

    console.log('[AiAgentService] callLlm called but no API key configured');
    return null;
  }

  async dispatch(
    ctx: AgentContext,
    action: AiAgentAction,
    request: any,
  ): Promise<AiAgentActionResponse> {
    const executedAt = new Date().toISOString();
    try {
      switch (action) {
        case AiAgentAction.SUGGEST_CONTACTS: {
          const data = await this.toolSuggestContacts(ctx, request.suggestContactsOptions ?? {});
          return { success: true, action, data, executedAt };
        }
        case AiAgentAction.SCHEDULE_REMINDER: {
          const data = await this.toolScheduleReminder(ctx, request.scheduleReminderOptions ?? {});
          return { success: true, action, data, executedAt };
        }
        case AiAgentAction.GENERATE_NOTE: {
          const data = await this.toolGenerateNote(ctx, request.generateNoteOptions ?? {});
          return { success: true, action, data, executedAt };
        }
        case AiAgentAction.ASSESS_RELATIONSHIP_HEALTH: {
          const data = await this.toolAssessRelationshipHealth(ctx, request);
          return { success: true, action, data, executedAt };
        }
        default:
          return {
            success: false,
            action,
            error: `Unknown action: ${String(action)}`,
            executedAt,
          };
      }
    } catch (err) {
      return {
        success: false,
        action,
        error: err instanceof Error ? err.message : String(err),
        executedAt,
      };
    }
  }

  // ========== Tool 1: suggestContacts ==========
  // Scores contacts on: stale days, birthday proximity, relationship score.
  // Returns top N contacts with human-readable reasons.
  async toolSuggestContacts(
    ctx: AgentContext,
    options: { limit?: number; reason?: string } = {},
  ): Promise<SuggestContactsResponse> {
    const limit = options.limit ?? 3;
    const filterReason = options.reason ?? "all";

    const where: any = { ownerId: ctx.userId, isDemo: false };
    if (ctx.vaultId) {
      where.vaultMemberships = { some: { vaultId: ctx.vaultId } };
    }

    const contacts = await this.prisma.contact.findMany({
      where,
      include: {
        _count: { select: { interactions: true } },
      },
    });

    const now = new Date();

    const scored = contacts.map((c) => {
      const lastContactedAt = c.lastContactedAt ?? null;
      const daysSinceContact = lastContactedAt
        ? Math.floor((now.getTime() - lastContactedAt.getTime()) / (1000 * 60 * 60 * 24))
        : null;

      // Stale score: 0-40 pts
      const staleScore = daysSinceContact !== null
        ? Math.min(40, (daysSinceContact / 14) * 40)
        : 40; // Never contacted = max stale

      // Birthday proximity score: 0-30 pts
      let birthdayScore = 0;
      if (c.birthday) {
        const bdayThisYear = new Date(now.getFullYear(), c.birthday.getMonth(), c.birthday.getDate());
        if (bdayThisYear < now) bdayThisYear.setFullYear(bdayThisYear.getFullYear() + 1);
        const daysUntilBday = Math.floor((bdayThisYear.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysUntilBday <= 30) birthdayScore = Math.max(0, 30 - daysUntilBday);
      }

      // Relationship score: 0-30 pts
      const relationshipScorePct = Math.round((c.relationshipScore ?? 50) * 0.3);

      const totalScore = staleScore + birthdayScore + relationshipScorePct;

      // Priority band
      let priority: "high" | "medium" | "low" = "medium";
      if (daysSinceContact === null || daysSinceContact > 60 || (c.relationshipScore ?? 50) < 30) {
        priority = "high";
      } else if (daysSinceContact <= 14 && (c.relationshipScore ?? 50) >= 60) {
        priority = "low";
      }

      // Reason string
      let reason = "";
      const name = c.firstName;
      if (daysSinceContact === null) {
        reason = `You have never contacted ${name}. A first hello could start something great!`;
      } else if (daysSinceContact > 60) {
        reason = `You have not contacted ${name} in ${daysSinceContact} days. Time for a reconnection!`;
      } else if (daysSinceContact > 30) {
        reason = `It has been ${daysSinceContact} days since your last connection with ${name}. A check-in is due.`;
      } else {
        reason = `Regular touchpoints help maintain the relationship with ${name}.`;
      }

      // Upcoming birthday flag
      const upcomingBirthday = (() => {
        if (!c.birthday) return false;
        const bdayThisYear = new Date(now.getFullYear(), c.birthday.getMonth(), c.birthday.getDate());
        if (bdayThisYear < now) bdayThisYear.setFullYear(bdayThisYear.getFullYear() + 1);
        const daysUntilBday = Math.floor((bdayThisYear.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        return daysUntilBday <= 30;
      })();

      return {
        contactId: c.id,
        contactName: `${c.firstName}${c.lastName ? ` ${c.lastName}` : ""}`,
        reason,
        priority,
        daysSinceContact: daysSinceContact ?? 0,
        relationshipScore: c.relationshipScore ?? 50,
        upcomingBirthday,
        totalScore,
      };
    });

    const filtered = filterReason === "all"
      ? scored
      : filterReason === "stale"
        ? scored.filter((c) => c.daysSinceContact > 14)
        : filterReason === "birthday"
          ? scored.filter((c) => c.upcomingBirthday)
          : scored.filter((c) => c.relationshipScore < 50);

    const contactsResult: SuggestedContact[] = filtered
      .sort((a, b) => b.totalScore - a.totalScore)
      .slice(0, limit)
      .map(({ totalScore: _s, ...rest }) => rest);

    // LLM enrichment: make reason strings sound human and personalized
    // Wrapped in try/catch — gracefully falls back to templated reasons on failure
    if (contactsResult.length > 0) {
      try {
        const contactsForLLM = contactsResult
          .map((c, i) => `${i + 1}. ${c.contactName} (priority: ${c.priority}, days since contact: ${c.daysSinceContact}, relationship score: ${c.relationshipScore}${c.upcomingBirthday ? ', birthday coming up' : ''})`)
          .join('\n');
        const llmPrompt = `You are a thoughtful relationship manager. Below are contacts that need attention. Rewrite each reason to sound natural, warm, and personalized — like a human assistant would say it. Keep each reason to 1-2 sentences.

Contacts:\n${contactsForLLM}

Respond with one reason per line, numbered to match. Do NOT add any prefix or commentary — just the reasons.`;
        const llmResult = await this.callLlm(llmPrompt, 600);
        if (llmResult) {
          const lines = llmResult.split('\n').filter(l => /^\d+\./.test(l.trim()));
          lines.forEach((line, i) => {
            const reason = line.replace(/^\d+\.\s*/, '').trim();
            if (reason && contactsResult[i]) {
              contactsResult[i].reason = reason;
            }
          });
        }
      } catch {
        // Fallback: keep existing templated reasons
      }
    }

    return { contacts: contactsResult };
  }

  // ========== Tool 2: scheduleReminder ==========
  // Given a contact, compute when to remind and what to say.
  async toolScheduleReminder(
    ctx: AgentContext,
    options: { type?: string } = {},
  ): Promise<ScheduleReminderResponse> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: ctx.contactId, ownerId: ctx.userId, isDemo: false },
      include: {},
    });

    const contactCelebrations = await this.prisma.contactCelebration.findMany({
      where: { contactId: ctx.contactId, status: "active" },
      include: { celebration: true },
      orderBy: { customDate: "asc" },
    });

    if (!contact) {
      throw new Error(`Contact ${ctx.contactId} not found`);
    }

    const now = new Date();
    const lastContactedAt = contact.lastContactedAt ?? null;
    const daysSinceContact = lastContactedAt
      ? Math.floor((now.getTime() - lastContactedAt.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const name = `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ""}`;
    let type: "birthday" | "followup" | "stale" | "celebration";
    let title: string;
    let scheduledAt: Date;
    let recurrenceRule: "none" | "yearly" | "monthly" | "weekly" = "none";
    let description: string;

    // Priority: birthday > celebration > stale > followup
    if (contact.birthday) {
      const bday = new Date(now.getFullYear(), contact.birthday.getMonth(), contact.birthday.getDate());
      if (bday < now) bday.setFullYear(bday.getFullYear() + 1);
      const daysUntil = Math.floor((bday.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (daysUntil <= 30) {
        type = "birthday";
        title = `${name}'s birthday`;
        scheduledAt = bday;
        recurrenceRule = "yearly";
        description = `${name}'s birthday is coming up on ${bday.toLocaleDateString()}. Do not forget to send your best wishes!`;
      } else {
        type = "followup";
        title = `Follow up with ${name}`;
        scheduledAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        description = `It has been ${daysSinceContact ?? "a while"} days since your last interaction with ${name}. A timely follow-up would be great.`;
      }
    } else if (contactCelebrations.length > 0) {
      const nextCc = contactCelebrations[0];
      const celebrationDate = nextCc.customDate ?? nextCc.celebration.fullDate;
      if (celebrationDate && celebrationDate > now) {
        type = "celebration";
        title = `${nextCc.celebration.name} for ${name}`;
        scheduledAt = celebrationDate;
        recurrenceRule = nextCc.celebration.fullDate ? "none" : "yearly";
        description = `${name} has a ${nextCc.celebration.name} coming up on ${scheduledAt.toLocaleDateString()}.`;
      } else {
        type = "followup";
        title = `Follow up with ${name}`;
        scheduledAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        description = `You have not connected with ${name} in a while. Consider reaching out.`;
      }
    } else if (daysSinceContact !== null && daysSinceContact > 30) {
      type = "followup";
      title = `Follow up with ${name}`;
      scheduledAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      recurrenceRule = "none";
      description = `It has been ${daysSinceContact} days since your last interaction with ${name}. A thoughtful follow-up could rekindle the connection.`;
    } else if (daysSinceContact !== null && daysSinceContact > 14) {
      type = "stale";
      title = `Check in with ${name}`;
      scheduledAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
      recurrenceRule = "none";
      description = `${name} has not heard from you in ${daysSinceContact} days. A quick check-in shows you care.`;
    } else {
      type = "followup";
      title = `Stay in touch with ${name}`;
      scheduledAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      recurrenceRule = "weekly";
      description = `Even though you recently connected with ${name}, regular touchpoints keep the relationship strong.`;
    }

    const reminder: SuggestedReminder = {
      contactId: ctx.contactId!,
      title,
      type,
      scheduledAt: scheduledAt.toISOString(),
      isRecurring: recurrenceRule !== "none",
      recurrenceRule,
      description,
    };

    return { suggestedReminder: reminder };
  }
  // ========== Tool 3: generateNote ==========
  async toolGenerateNote(
    ctx: AgentContext,
    options: { format?: string; tone?: string } = {},
  ): Promise<GenerateNoteResponse> {
    const format = options.format ?? "message";
    const tone = options.tone ?? "casual";

    const contact = await this.prisma.contact.findFirst({
      where: { id: ctx.contactId, ownerId: ctx.userId },
    });

    if (!contact) {
      throw new Error(`Contact ${ctx.contactId} not found`);
    }

    const name = `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ""}`;
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const recentInteractions = await this.prisma.interaction.findMany({
      where: { contactId: ctx.contactId, ownerId: ctx.userId, occurredAt: { gte: ninetyDaysAgo } },
      orderBy: { occurredAt: "desc" },
      take: 5,
    });

    const lastInteraction = recentInteractions[0];
    const lastContent = lastInteraction?.content ?? null;
    const lastType = lastInteraction?.type ?? null;
    const company = contact.company ?? "their work";
    const jobTitle = contact.jobTitle ?? "";

    const interactionContext = lastContent
      ? `Their last interaction (${lastType}): "${lastContent.substring(0, 200)}"`
      : `No recent interactions on file.`;
    const daysSince = lastInteraction
      ? Math.floor((Date.now() - lastInteraction.occurredAt.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const prompt = `You are a thoughtful relationship manager helping draft a ${tone} ${format} to reconnect with ${name}.
${name} works as ${jobTitle || 'a professional'} at ${company}.
${interactionContext}
Days since last contact: ${daysSince !== null ? daysSince : 'unknown'}.

Generate a ${tone} ${format} that feels genuine, personal, and appropriate for the relationship context.
${format === 'email' ? 'Start with a Subject: line, then the body.' : ''}
${format === 'meeting' ? 'Include talking points as a JSON array of strings.' : ''}
Do NOT use generic templates — make it specific to this person and context.`;

    // Use injected anthropic service (direct), fall back to injected llm (OpenRouter)
    const activeLlm = this.anthropic.isConfigured ? this.anthropic : (this.llm.isConfigured ? this.llm : null);
    let content = '';
    let subject: string | undefined;
    let talkingPoints: string[] | undefined;

    if (activeLlm) {
      try {
        const raw = await activeLlm.complete(prompt, { maxTokens: 1024 });
        if (raw) {
          if (format === 'email') {
            const subjectMatch = raw.match(/^Subject:\s*(.+)$/m);
            if (subjectMatch) subject = subjectMatch[1].trim();
            content = raw.replace(/^Subject:\s*.+$/m, '').trim();
          } else {
            content = raw;
          }
        }
      } catch (error) {
        console.error('[AiAgentService] LLM error in toolGenerateNote:', error instanceof Error ? error.message : error);
      }
    }

    // Template fallback (when no API key or on error)
    if (!content) {
      if (format === 'message') {
        if (tone === 'casual') {
          content = `Hey ${contact.firstName}! It has been a while -- hope you are doing well. Would love to catch up soon.`;
        } else if (tone === 'warm') {
          content = `Hi ${contact.firstName}, I have been thinking about you lately. It has been a while since we caught up, and I would love to hear how things are going${jobTitle ? ` especially ${jobTitle} at ${company}` : ''}. Take care!`;
        } else {
          content = `Hi ${contact.firstName}, I hope this message finds you well. I would like to schedule a call to catch up at your convenience.`;
        }
      } else if (format === 'email') {
        subject = `It has been a while, ${contact.firstName} -- let us catch up`;
        if (tone === 'casual') {
          content = `Hi ${contact.firstName},

Hope you are doing great! It has been a while since we caught up. I would love to hear how things are going -- especially with ${company}.

Let me know if you would like to grab coffee or jump on a call sometime.

Best,
`;
        } else if (tone === 'warm') {
          content = `Dear ${contact.firstName},

I have been meaning to reach out for some time now. Our conversation last time about ${lastContent ? `"${lastContent.substring(0, 40)}..."` : 'various topics'} left a strong impression on me.

I would love to reconnect and hear how things have been, particularly in your work${company ? ` at ${company}` : ''}.

Warm regards,
`;
        } else {
          content = `Hi ${contact.firstName},

I wanted to follow up regarding our previous conversation. Please let me know your availability for a brief call this week.

Best regards,
`;
        }
      } else if (format === 'meeting') {
        talkingPoints = [
          `Catch up on what is new with ${name}${company ? `, especially ${jobTitle} at ${company}` : ''}`
        ];
        if (lastContent) {
          talkingPoints.push(`Follow up on: "${lastContent.substring(0, 60)}..."`);
        } else {
          talkingPoints.push('Discuss shared interests and goals');
        }
        talkingPoints.push('Explore opportunities for collaboration or mutual support');
        if (lastType) {
          talkingPoints.push(`Note: your last interaction was a ${lastType}`);
        } else {
          talkingPoints.push('Build rapport and strengthen the relationship');
        }
        content = `Meeting agenda for reconnection with ${name}`;
      }
    }

    const note: GeneratedNote = {
      format: format as "message" | "email" | "meeting",
      content,
      tone,
    };
    if (subject !== undefined) (note as any).subject = subject;
    if (talkingPoints !== undefined) (note as any).talkingPoints = talkingPoints;

    return { note };
  }
  // ========== Tool 4: assessRelationshipHealth ==========
  // Returns a 0-100 health score, insight, and one action recommendation.
  async toolAssessRelationshipHealth(
    ctx: AgentContext,
    _request: any,
  ): Promise<AssessRelationshipHealthResponse> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: ctx.contactId, ownerId: ctx.userId, isDemo: false },
    });

    if (!contact) {
      throw new Error(`Contact ${ctx.contactId} not found`);
    }

    const name = `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ""}`;
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const recentInteractions = await this.prisma.interaction.findMany({
      where: { contactId: ctx.contactId, ownerId: ctx.userId, occurredAt: { gte: ninetyDaysAgo } },
      orderBy: { occurredAt: "desc" },
    });

    const lastInteraction = recentInteractions[0];
    const lastContactedAt = contact.lastContactedAt ?? null;
    const daysSinceContact = lastContactedAt
      ? Math.floor((now.getTime() - lastContactedAt.getTime()) / (1000 * 60 * 60 * 24))
      : null;
    const interactionCount90d = recentInteractions.length;
    const lastInteractionType = lastInteraction?.type ?? null;

    // Health score formula (0-100)
    let base = 50;
    if (daysSinceContact === null) {
      base -= 30;
    } else if (daysSinceContact > 60) {
      base -= 20;
    } else if (daysSinceContact > 30) {
      base -= 10;
    } else if (daysSinceContact <= 7) {
      base += 20;
    } else if (daysSinceContact <= 14) {
      base += 10;
    }
    const interactionBoost = Math.min(20, interactionCount90d * 3);
    const frequencyBoost = interactionCount90d >= 2 ? 10 : 0;
    const healthScore = Math.max(0, Math.min(100, base + interactionBoost + frequencyBoost));

    const healthBand: "excellent" | "healthy" | "needs-attention" | "at-risk" =
      healthScore >= 80 ? "excellent" :
      healthScore >= 60 ? "healthy" :
      healthScore >= 40 ? "needs-attention" : "at-risk";

    // Insight string
    let insight = "";
    if (daysSinceContact === null) {
      insight = `You have never logged an interaction with ${name}. Starting a conversation would set the foundation for this relationship.`;
    } else if (daysSinceContact > 60) {
      insight = `You have not contacted ${name} in ${daysSinceContact} days. This relationship needs attention to prevent it from fading.`;
    } else if (daysSinceContact > 30) {
      insight = `It has been ${daysSinceContact} days since your last interaction with ${name}. A check-in would be well-timed.`;
    } else if (daysSinceContact > 14) {
      insight = `${name} was last contacted ${daysSinceContact} days ago. Everything looks stable but a touchpoint would help.`;
    } else {
      insight = `You have been actively engaging with ${name}. This relationship is in great shape.`;
    }

    // One actionable recommendation
    let recommendation = "";
    if (healthBand === "at-risk") {
      recommendation = `Schedule a call or send a message to ${name} this week. A personal touch can quickly restore this relationship.`;
    } else if (healthBand === "needs-attention") {
      recommendation = `Set a reminder to check in with ${name} in the next few days. Consistency is key.`;
    } else if (healthBand === "healthy") {
      recommendation = `Keep the momentum going. A message or small gesture with ${name} in the next week or two would be ideal.`;
    } else {
      recommendation = `Great work! Consider introducing ${name} to someone in your network who shares their interests.`;
    }

    // LLM enrichment: personalized insight and recommendation
    try {
      const llmPrompt = `You are a relationship coach reviewing a ${healthBand} relationship with ${name}.
Health score: ${healthScore}/100.
Days since contact: ${daysSinceContact ?? 'never contacted'}.
Interactions in last 90 days: ${interactionCount90d}.
Last interaction type: ${lastInteractionType ?? 'none'}.

Write a 1-sentence insight about this relationship's current state, then a 1-sentence actionable recommendation.
Respond in this format:
INSIGHT: <insight>
RECOMMENDATION: <recommendation>`;
      const llmResult = await this.callLlm(llmPrompt, 300);
      if (llmResult) {
        const insightMatch = llmResult.match(/^INSIGHT:\s*(.+)$/m);
        const recMatch = llmResult.match(/^RECOMMENDATION:\s*(.+)$/m);
        if (insightMatch) insight = insightMatch[1].trim();
        if (recMatch) recommendation = recMatch[1].trim();
      }
    } catch {
      // Fallback: keep templated insight/recommendation
    }

    const assessment: RelationshipAssessment = {
      contactId: ctx.contactId!,
      contactName: name,
      healthScore,
      healthBand,
      insight,
      recommendation,
      stats: {
        daysSinceContact,
        interactionCount90d,
        lastInteractionType,
      },
    };

    return { assessment };
  }
}
