import { z } from 'zod';
import {
  AGENT_ERROR_CODES,
  AGENT_RISK_LEVELS,
  AGENT_SCOPES,
  PROPOSAL_ACTION_TYPES,
} from './contracts.js';

const entityIdSchema = z.string().min(1).max(128);
const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);
const isoTimestampSchema = z.string().datetime({ offset: true });

export const agentScopeSchema = z.enum(AGENT_SCOPES);
export const agentRiskLevelSchema = z.enum(AGENT_RISK_LEVELS);
export const agentErrorCodeSchema = z.enum(AGENT_ERROR_CODES);
export const proposalActionTypeSchema = z.enum(PROPOSAL_ACTION_TYPES);

export const agentPrincipalSchema = z.strictObject({
  ownerId: entityIdSchema,
  clientId: entityIdSchema,
  credentialId: entityIdSchema,
  clientName: z.string().min(1).max(100),
  scopes: z
    .array(agentScopeSchema)
    .min(1)
    .refine((scopes) => new Set(scopes).size === scopes.length, {
      message: 'Agent scopes must be unique',
    }),
});

export const agentToolMetadataSchema = z.strictObject({
  name: z.string().regex(/^socos_[a-z0-9_]+$/),
  description: z.string().min(1).max(500),
  requiredScope: agentScopeSchema,
  risk: agentRiskLevelSchema,
  requiresIdempotencyKey: z.boolean(),
});

const agentErrorDetailsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

export const agentPublicErrorSchema = z.strictObject({
  code: agentErrorCodeSchema,
  message: z.string().min(1).max(500),
  retryable: z.boolean(),
  details: agentErrorDetailsSchema.optional(),
});

export function agentResultSchema<T extends z.ZodType>(dataSchema: T) {
  return z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), data: dataSchema }),
    z.strictObject({ ok: z.literal(false), error: agentPublicErrorSchema }),
  ]);
}

export const agentBriefFeedbackInputSchema = z.discriminatedUnion('action', [
  z.strictObject({
    itemId: entityIdSchema,
    idempotencyKey: idempotencyKeySchema,
    action: z.literal('accept'),
  }),
  z.strictObject({
    itemId: entityIdSchema,
    idempotencyKey: idempotencyKeySchema,
    action: z.literal('snooze'),
    snoozedUntil: isoTimestampSchema,
  }),
  z.strictObject({
    itemId: entityIdSchema,
    idempotencyKey: idempotencyKeySchema,
    action: z.literal('dismiss'),
    reason: z.string().max(500).optional(),
  }),
]);

export const agentQuestCompletionInputSchema = z.union([
  z.strictObject({
    questId: entityIdSchema,
    idempotencyKey: idempotencyKeySchema,
    interactionId: entityIdSchema,
  }),
  z.strictObject({
    questId: entityIdSchema,
    idempotencyKey: idempotencyKeySchema,
    reminderId: entityIdSchema,
  }),
]);

const messageProposalPayloadSchema = z.strictObject({
  contactId: entityIdSchema,
  channel: z.enum(['email', 'sms', 'social', 'other']),
  body: z.string().min(1).max(10_000),
});

const introductionProposalPayloadSchema = z.strictObject({
  contactId: entityIdSchema,
  otherContactId: entityIdSchema,
  context: z.string().max(2_000).optional(),
});

const invitationProposalPayloadSchema = z.strictObject({
  contactId: entityIdSchema,
  title: z.string().min(1).max(500),
  scheduledAt: isoTimestampSchema.optional(),
});

const mergeProposalPayloadSchema = z
  .strictObject({
    sourceContactId: entityIdSchema,
    targetContactId: entityIdSchema,
  })
  .refine((payload) => payload.sourceContactId !== payload.targetContactId, {
    message: 'Merge contacts must be different',
  });

const deleteProposalPayloadSchema = z.strictObject({
  entityType: z.enum(['contact', 'interaction', 'reminder']),
  entityId: entityIdSchema,
});

export const agentActionProposalInputSchema = z.discriminatedUnion(
  'actionType',
  [
    z.strictObject({
      actionType: z.literal('message'),
      idempotencyKey: idempotencyKeySchema,
      payload: messageProposalPayloadSchema,
    }),
    z.strictObject({
      actionType: z.literal('introduction'),
      idempotencyKey: idempotencyKeySchema,
      payload: introductionProposalPayloadSchema,
    }),
    z.strictObject({
      actionType: z.literal('invitation'),
      idempotencyKey: idempotencyKeySchema,
      payload: invitationProposalPayloadSchema,
    }),
    z.strictObject({
      actionType: z.literal('merge'),
      idempotencyKey: idempotencyKeySchema,
      payload: mergeProposalPayloadSchema,
    }),
    z.strictObject({
      actionType: z.literal('delete'),
      idempotencyKey: idempotencyKeySchema,
      payload: deleteProposalPayloadSchema,
    }),
  ],
);
