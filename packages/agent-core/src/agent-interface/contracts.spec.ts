import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { AgentPrincipal as PublicAgentPrincipal } from '@socos/agent-core/agent-interface';
import {
  AGENT_ERROR_CODES,
  AGENT_RISK_LEVELS,
  AGENT_SCOPES,
  PROPOSAL_ACTION_TYPES,
  agentActionProposalInputSchema,
  agentApprovedActionInputSchema,
  agentBriefFeedbackInputSchema,
  agentPrincipalSchema,
  agentQuestCompletionInputSchema,
  agentResultSchema,
  agentToolMetadataSchema,
} from './index.js';
import * as publicApi from '../index.js';

describe('agent interface constants', () => {
  it('exports the immutable least-privilege scope set', () => {
    expect(AGENT_SCOPES).toEqual([
      'contacts:read',
      'relationships:read',
      'dates:read',
      'reminders:read',
      'briefs:read',
      'enrichment:read',
      'interactions:write',
      'reminders:write',
      'feedback:write',
      'quests:complete',
      'proposals:write',
      'enrichment:candidates:write',
      'enrichment:accept',
      'approvals:execute',
    ]);
    expect(Object.isFrozen(AGENT_SCOPES)).toBe(true);
    expect(AGENT_RISK_LEVELS).toEqual([
      'read',
      'automatic',
      'approval_required',
    ]);
    expect(Object.isFrozen(AGENT_RISK_LEVELS)).toBe(true);
    expect(Object.isFrozen(AGENT_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(PROPOSAL_ACTION_TYPES)).toBe(true);
  });

  it('re-exports runtime contracts from the package root', () => {
    expect(publicApi.AGENT_SCOPES).toBe(AGENT_SCOPES);
    expect(publicApi.agentPrincipalSchema).toBe(agentPrincipalSchema);
    expect(publicApi.agentActionProposalInputSchema).toBe(
      agentActionProposalInputSchema,
    );
  });
});

describe('server-owned contracts', () => {
  it('exposes the versioned daily brief contract from the package root', () => {
    const brief: publicApi.DailyBrief = {
      schemaVersion: '1.1',
      briefId: 'brief-synthetic',
      localDate: '2026-07-16',
      timeZone: 'UTC',
      generatedAt: '2026-07-16T08:00:00.000Z',
      people: [],
      dates: [],
      events: [],
      quests: [],
      allowedActions: ['accept', 'snooze', 'dismiss', 'complete'],
    };

    expect(brief.schemaVersion).toBe('1.1');
    expect(brief.events).toEqual([]);
  });

  it('parses a strict authenticated principal with unique scopes', () => {
    const principal = {
      ownerId: 'owner-synthetic',
      clientId: 'client-synthetic',
      credentialId: 'credential-synthetic',
      clientName: 'Hermes Synthetic',
      scopes: ['contacts:read', 'briefs:read'],
    };

    const publicPrincipal: PublicAgentPrincipal =
      agentPrincipalSchema.parse(principal);

    expect(publicPrincipal).toEqual(principal);
    expect(() =>
      agentPrincipalSchema.parse({ ...principal, token: 'not-allowed' }),
    ).toThrow();
    expect(() =>
      agentPrincipalSchema.parse({
        ...principal,
        scopes: ['contacts:read', 'contacts:read'],
      }),
    ).toThrow();
  });

  it('parses strict tool metadata and rejects invented scopes', () => {
    const metadata = {
      name: 'socos_brief_today',
      description: "Read today's durable social brief.",
      requiredScope: 'briefs:read',
      risk: 'read',
      requiresIdempotencyKey: false,
    };

    expect(agentToolMetadataSchema.parse(metadata)).toEqual(metadata);
    expect(() =>
      agentToolMetadataSchema.parse({ ...metadata, requiredScope: 'admin' }),
    ).toThrow();
    expect(() =>
      agentToolMetadataSchema.parse({ ...metadata, ownerId: 'caller-owner' }),
    ).toThrow();
  });

  it('provides an exclusive canonical result envelope', () => {
    const resultSchema = agentResultSchema(
      z.strictObject({ value: z.string() }),
    );
    const success = { ok: true, data: { value: 'synthetic' } };
    const failure = {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'The request is invalid.',
        retryable: false,
      },
    };

    expect(resultSchema.parse(success)).toEqual(success);
    expect(resultSchema.parse(failure)).toEqual(failure);
    expect(() =>
      resultSchema.parse({ ...success, error: failure.error }),
    ).toThrow();
    expect(() =>
      resultSchema.parse({ ...failure, data: { value: 'leak' } }),
    ).toThrow();
  });
});

describe('strict caller inputs', () => {
  it.each([
    {
      itemId: 'item-synthetic',
      idempotencyKey: 'feedback:intent-001',
      action: 'accept',
    },
    {
      itemId: 'item-synthetic',
      idempotencyKey: 'feedback:intent-002',
      action: 'snooze',
      snoozedUntil: '2026-07-17T08:00:00.000Z',
    },
    {
      itemId: 'item-synthetic',
      idempotencyKey: 'feedback:intent-003',
      action: 'dismiss',
      reason: 'Synthetic dismissal',
    },
  ])('accepts an action-specific feedback input', (input) => {
    expect(agentBriefFeedbackInputSchema.parse(input)).toEqual(input);
  });

  it.each(['ownerId', 'userId', 'clientId', 'xpReward'])(
    'rejects caller-owned %s on feedback',
    (field) => {
      expect(() =>
        agentBriefFeedbackInputSchema.parse({
          itemId: 'item-synthetic',
          idempotencyKey: 'feedback:intent-004',
          action: 'accept',
          [field]: field === 'xpReward' ? 999 : 'caller-value',
        }),
      ).toThrow();
    },
  );

  it('rejects fields belonging to another feedback action', () => {
    expect(() =>
      agentBriefFeedbackInputSchema.parse({
        itemId: 'item-synthetic',
        idempotencyKey: 'feedback:intent-005',
        action: 'accept',
        reason: 'Not valid for accept',
      }),
    ).toThrow();
  });

  it.each([
    {
      questId: 'quest-synthetic',
      idempotencyKey: 'quest:intent-001',
      interactionId: 'interaction-synthetic',
    },
    {
      questId: 'quest-synthetic',
      idempotencyKey: 'quest:intent-002',
      reminderId: 'reminder-synthetic',
    },
  ])('accepts exactly one quest evidence type', (input) => {
    expect(agentQuestCompletionInputSchema.parse(input)).toEqual(input);
  });

  it('rejects ambiguous, missing, and client-reward quest completion', () => {
    const base = {
      questId: 'quest-synthetic',
      idempotencyKey: 'quest:intent-003',
    };
    expect(() => agentQuestCompletionInputSchema.parse(base)).toThrow();
    expect(() =>
      agentQuestCompletionInputSchema.parse({
        ...base,
        interactionId: 'interaction-synthetic',
        reminderId: 'reminder-synthetic',
      }),
    ).toThrow();
    expect(() =>
      agentQuestCompletionInputSchema.parse({
        ...base,
        interactionId: 'interaction-synthetic',
        xpReward: 999,
      }),
    ).toThrow();
  });

  it.each([
    {
      actionType: 'message',
      payload: {
        contactId: 'contact-synthetic',
        channel: 'email',
        body: 'Synthetic draft',
      },
    },
    {
      actionType: 'introduction',
      payload: {
        contactId: 'contact-a-synthetic',
        otherContactId: 'contact-b-synthetic',
        context: 'Synthetic context',
      },
    },
    {
      actionType: 'invitation',
      payload: {
        contactId: 'contact-synthetic',
        title: 'Synthetic invitation',
        scheduledAt: '2026-07-20T10:00:00.000Z',
      },
    },
    {
      actionType: 'merge',
      payload: {
        sourceContactId: 'contact-source-synthetic',
        targetContactId: 'contact-target-synthetic',
      },
    },
    {
      actionType: 'delete',
      payload: {
        entityType: 'reminder',
        entityId: 'reminder-synthetic',
      },
    },
  ])('parses a strict $actionType proposal', (input) => {
    const request = {
      ...input,
      idempotencyKey: `proposal:${input.actionType}:001`,
    };
    expect(agentActionProposalInputSchema.parse(request)).toEqual(request);
  });

  it('rejects ownership, rewards, unknown fields, and nested ownership in proposals', () => {
    const proposal = {
      actionType: 'message',
      idempotencyKey: 'proposal:message:002',
      payload: {
        contactId: 'contact-synthetic',
        channel: 'email',
        body: 'Synthetic draft',
      },
    };

    for (const forbidden of [
      { ownerId: 'caller-owner' },
      { userId: 'caller-user' },
      { clientId: 'caller-client' },
      { xpReward: 999 },
      { unknown: true },
    ]) {
      expect(() =>
        agentActionProposalInputSchema.parse({ ...proposal, ...forbidden }),
      ).toThrow();
    }
    expect(() =>
      agentActionProposalInputSchema.parse({
        ...proposal,
        payload: { ...proposal.payload, ownerId: 'caller-owner' },
      }),
    ).toThrow();
  });

  it('binds approved execution to a strict grant, action, and payload', () => {
    const input = {
      grantId: 'grant-synthetic',
      actionType: 'message',
      idempotencyKey: 'execute:message:001',
      payload: {
        contactId: 'contact-synthetic',
        channel: 'social',
        body: 'Synthetic approved draft',
      },
    };

    expect(agentApprovedActionInputSchema.parse(input)).toEqual(input);
    expect(() =>
      agentApprovedActionInputSchema.parse({
        ...input,
        ownerId: 'caller-owner',
      }),
    ).toThrow();
    expect(() =>
      agentApprovedActionInputSchema.parse({
        ...input,
        actionType: 'delete',
      }),
    ).toThrow();
  });
});
