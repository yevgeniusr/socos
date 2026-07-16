import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import {
  agentActionProposalInputSchema,
  agentApprovedActionInputSchema,
  agentBriefFeedbackInputSchema,
  agentQuestCompletionInputSchema,
  type AgentActionProposalInput,
  type AgentApprovedActionInput,
  type AgentBriefFeedbackInput,
  type AgentPrincipal,
  type AgentPublicError,
  type AgentQuestCompletionInput,
  type AgentToolMetadata,
} from "@socos/agent-core";
import { z } from "zod";
import { ActionProposalService } from "../agent-security/action-proposal.service.js";
import { ApprovedActionExecutionService } from "../agent-security/approved-action-execution.service.js";
import { hashCanonicalJson } from "../agent-security/canonical-json.js";
import type {
  BriefFeedbackResult,
  QuestCompletionResult,
} from "../briefs/brief-feedback.service.js";
import type {
  BriefItemFeedbackDto,
  QuestCompletionDto,
} from "../briefs/briefs.dto.js";
import type {
  AgentInteractionInput,
  AgentInteractionResult,
} from "../interactions/interactions.service.js";
import { InteractionType } from "../interactions/interactions.dto.js";
import type {
  AgentReminderInput,
  AgentReminderResult,
} from "../reminders/reminders.service.js";
import { ReminderType, RepeatInterval } from "../reminders/reminders.dto.js";
import { AgentReadService } from "./agent-read.service.js";

const entityId = z.string().min(1).max(128);
const idempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);
const isoTimestamp = z.string().datetime({ offset: true });
const emptyInputSchema = z.strictObject({});
const contactsSearchInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(20).default(10),
});
const relationshipHealthInputSchema = z.strictObject({ contactId: entityId });
const importantDatesInputSchema = z.strictObject({
  horizonDays: z.number().int().min(1).max(90).default(14),
});
const remindersListInputSchema = z.strictObject({
  limit: z.number().int().min(1).max(20).default(20),
});
const logInteractionInputSchema = z.strictObject({
  idempotencyKey,
  contactId: entityId,
  type: z.enum(InteractionType),
  title: z.string().max(500).optional(),
  content: z.string().max(10_000).optional(),
  occurredAt: isoTimestamp.optional(),
  duration: z
    .number()
    .int()
    .min(1)
    .max(24 * 60)
    .optional(),
  location: z.string().max(500).optional(),
});
const createReminderInputSchema = z
  .strictObject({
    idempotencyKey,
    contactId: entityId,
    type: z.enum(ReminderType),
    title: z.string().min(1).max(500),
    description: z.string().max(2_000).optional(),
    scheduledAt: isoTimestamp,
    repeatInterval: z.enum(RepeatInterval).optional(),
    isRecurring: z.boolean().optional(),
  })
  .superRefine((input, context) => {
    if (
      (input.isRecurring === true && input.repeatInterval === undefined) ||
      (input.isRecurring !== true && input.repeatInterval !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "Recurring reminders require exactly one repeat interval.",
        path: ["repeatInterval"],
      });
    }
  });

export const AGENT_INTERACTION_COMMANDS = Symbol("AGENT_INTERACTION_COMMANDS");
export const AGENT_REMINDER_COMMANDS = Symbol("AGENT_REMINDER_COMMANDS");
export const AGENT_FEEDBACK_COMMANDS = Symbol("AGENT_FEEDBACK_COMMANDS");

export interface AgentInteractionCommands {
  createForAgent(
    ownerId: string,
    dto: AgentInteractionInput,
    transaction: Prisma.TransactionClient
  ): Promise<AgentInteractionResult>;
}

export interface AgentReminderCommands {
  createForAgent(
    ownerId: string,
    dto: AgentReminderInput,
    transaction: Prisma.TransactionClient
  ): Promise<AgentReminderResult>;
}

export interface AgentFeedbackCommands {
  recordItemFeedbackForAgent(
    ownerId: string,
    itemId: string,
    idempotencyKey: string,
    dto: BriefItemFeedbackDto,
    transaction: Prisma.TransactionClient
  ): Promise<BriefFeedbackResult>;
  completeQuestForAgent(
    ownerId: string,
    questId: string,
    idempotencyKey: string,
    dto: QuestCompletionDto,
    transaction: Prisma.TransactionClient
  ): Promise<QuestCompletionResult>;
}

export type AgentToolHandler = (
  principal: AgentPrincipal,
  input: never,
  transaction?: Prisma.TransactionClient
) => Promise<unknown>;

export interface ExplicitAgentTool {
  metadata: AgentToolMetadata;
  inputSchema: z.ZodType;
  handler: AgentToolHandler;
}

type ContactsSearchInput = z.infer<typeof contactsSearchInputSchema>;
type RelationshipHealthInput = z.infer<typeof relationshipHealthInputSchema>;
type ImportantDatesInput = z.infer<typeof importantDatesInputSchema>;
type RemindersListInput = z.infer<typeof remindersListInputSchema>;
type LogInteractionInput = z.infer<typeof logInteractionInputSchema>;
type CreateReminderInput = z.infer<typeof createReminderInputSchema>;

@Injectable()
export class AgentToolHandlers {
  constructor(
    private readonly reads: AgentReadService,
    @Inject(AGENT_INTERACTION_COMMANDS)
    private readonly interactions: AgentInteractionCommands,
    @Inject(AGENT_REMINDER_COMMANDS)
    private readonly reminders: AgentReminderCommands,
    @Inject(AGENT_FEEDBACK_COMMANDS)
    private readonly feedback: AgentFeedbackCommands,
    private readonly proposals: ActionProposalService,
    private readonly executions: ApprovedActionExecutionService
  ) {}

  briefToday(principal: AgentPrincipal) {
    return this.reads.briefToday(principal.ownerId, new Date());
  }

  contactsSearch(principal: AgentPrincipal, input: ContactsSearchInput) {
    return this.reads.contactsSearch(
      principal.ownerId,
      input.query,
      input.limit
    );
  }

  relationshipHealth(
    principal: AgentPrincipal,
    input: RelationshipHealthInput
  ) {
    return this.reads.relationshipHealth(
      principal.ownerId,
      input.contactId,
      new Date()
    );
  }

  importantDates(principal: AgentPrincipal, input: ImportantDatesInput) {
    return this.reads.importantDates(
      principal.ownerId,
      input.horizonDays,
      new Date()
    );
  }

  remindersList(principal: AgentPrincipal, input: RemindersListInput) {
    return this.reads.remindersList(principal.ownerId, input.limit);
  }

  async logInteraction(
    principal: AgentPrincipal,
    input: LogInteractionInput,
    transaction: Prisma.TransactionClient
  ) {
    const { idempotencyKey: _key, ...dto } = input;
    const created = await this.interactions.createForAgent(
      principal.ownerId,
      dto,
      transaction
    );
    return {
      interactionId: created.interactionId,
      type: created.type,
      occurredAt: created.occurredAt.toISOString(),
      xpEarned: created.xpAwarded,
    };
  }

  async createReminder(
    principal: AgentPrincipal,
    input: CreateReminderInput,
    transaction: Prisma.TransactionClient
  ) {
    const { idempotencyKey: _key, ...dto } = input;
    const reminder = await this.reminders.createForAgent(
      principal.ownerId,
      dto,
      transaction
    );
    return {
      reminderId: reminder.reminderId,
      contactId: reminder.contactId,
      type: reminder.type,
      scheduledAt: reminder.scheduledAt.toISOString(),
      status: reminder.status,
    };
  }

  async briefFeedback(
    principal: AgentPrincipal,
    input: AgentBriefFeedbackInput,
    transaction: Prisma.TransactionClient
  ) {
    const { itemId, idempotencyKey, ...dto } = input;
    const feedback = await this.feedback.recordItemFeedbackForAgent(
      principal.ownerId,
      itemId,
      domainIdempotencyKey(
        principal.clientId,
        "socos_brief_feedback",
        idempotencyKey,
        input
      ),
      dto,
      transaction
    );
    return {
      feedbackId: feedback.feedbackId,
      itemId: feedback.itemId,
      action: feedback.action,
      status: feedback.status,
      snoozedUntil: feedback.snoozedUntil?.toISOString() ?? null,
    };
  }

  async completeQuest(
    principal: AgentPrincipal,
    input: AgentQuestCompletionInput,
    transaction: Prisma.TransactionClient
  ) {
    const { questId, idempotencyKey, ...dto } = input;
    const completion = await this.feedback.completeQuestForAgent(
      principal.ownerId,
      questId,
      domainIdempotencyKey(
        principal.clientId,
        "socos_complete_quest",
        idempotencyKey,
        input
      ),
      dto,
      transaction
    );
    return {
      feedbackId: completion.feedbackId,
      questId: completion.questId,
      status: completion.status,
      completedAt: completion.completedAt.toISOString(),
      xpAwarded: completion.xpAwarded,
    };
  }

  async proposeAction(
    principal: AgentPrincipal,
    input: AgentActionProposalInput,
    transaction: Prisma.TransactionClient
  ) {
    const proposal = await this.proposals.createProposal(
      principal,
      input,
      transaction
    );
    return {
      proposalId: proposal.id,
      actionType: proposal.actionType,
      riskLevel: proposal.riskLevel,
      preview: proposal.preview,
      status: proposal.status,
      expiresAt: proposal.expiresAt.toISOString(),
      createdAt: proposal.createdAt.toISOString(),
    };
  }

  async executeApprovedAction(
    principal: AgentPrincipal,
    input: AgentApprovedActionInput,
    transaction: Prisma.TransactionClient
  ) {
    const result = await this.executions.execute(principal, input, transaction);
    if (result.ok === false) throw new AgentHandlerError(result.error);
    return result.data;
  }
}

export class AgentHandlerError extends Error {
  constructor(readonly publicError: AgentPublicError) {
    super(publicError.message);
  }
}

function domainIdempotencyKey(
  clientId: string,
  operation: string,
  callerKey: string,
  request: AgentBriefFeedbackInput | AgentQuestCompletionInput
): string {
  return `agent:${hashCanonicalJson([
    clientId,
    operation,
    callerKey,
    request,
  ])}`;
}

export function createExplicitAgentTools(
  handlers: AgentToolHandlers
): readonly ExplicitAgentTool[] {
  return Object.freeze([
    tool(
      "socos_brief_today",
      "Read today's durable social brief.",
      "briefs:read",
      "read",
      false,
      emptyInputSchema,
      handlers.briefToday.bind(handlers)
    ),
    tool(
      "socos_contacts_search",
      "Search non-demo contacts by name or company.",
      "contacts:read",
      "read",
      false,
      contactsSearchInputSchema,
      handlers.contactsSearch.bind(handlers)
    ),
    tool(
      "socos_relationship_health",
      "Read relationship cadence health for one contact.",
      "relationships:read",
      "read",
      false,
      relationshipHealthInputSchema,
      handlers.relationshipHealth.bind(handlers)
    ),
    tool(
      "socos_important_dates",
      "Read upcoming important dates.",
      "dates:read",
      "read",
      false,
      importantDatesInputSchema,
      handlers.importantDates.bind(handlers)
    ),
    tool(
      "socos_reminders_list",
      "Read pending non-demo reminders.",
      "reminders:read",
      "read",
      false,
      remindersListInputSchema,
      handlers.remindersList.bind(handlers)
    ),
    tool(
      "socos_log_interaction",
      "Record a contact interaction.",
      "interactions:write",
      "automatic",
      true,
      logInteractionInputSchema,
      handlers.logInteraction.bind(handlers)
    ),
    tool(
      "socos_create_reminder",
      "Create a reminder without outbound delivery.",
      "reminders:write",
      "automatic",
      true,
      createReminderInputSchema,
      handlers.createReminder.bind(handlers)
    ),
    tool(
      "socos_brief_feedback",
      "Record feedback on a brief item.",
      "feedback:write",
      "automatic",
      true,
      agentBriefFeedbackInputSchema,
      handlers.briefFeedback.bind(handlers)
    ),
    tool(
      "socos_complete_quest",
      "Complete a quest with durable evidence.",
      "quests:complete",
      "automatic",
      true,
      agentQuestCompletionInputSchema,
      handlers.completeQuest.bind(handlers)
    ),
    tool(
      "socos_propose_action",
      "Create a preview for a human-approved action.",
      "proposals:write",
      "approval_required",
      true,
      agentActionProposalInputSchema,
      handlers.proposeAction.bind(handlers)
    ),
    tool(
      "socos_execute_approved_action",
      "Execute an exact action with a bound human approval.",
      "approvals:execute",
      "approval_required",
      true,
      agentApprovedActionInputSchema,
      handlers.executeApprovedAction.bind(handlers)
    ),
  ]);
}

function tool(
  name: AgentToolMetadata["name"],
  description: string,
  requiredScope: AgentToolMetadata["requiredScope"],
  risk: AgentToolMetadata["risk"],
  requiresIdempotencyKey: boolean,
  inputSchema: z.ZodType,
  handler: AgentToolHandler
): ExplicitAgentTool {
  return Object.freeze({
    metadata: Object.freeze({
      name,
      description,
      requiredScope,
      risk,
      requiresIdempotencyKey,
    }),
    inputSchema,
    handler,
  });
}
