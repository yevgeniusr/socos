export const AGENT_SCOPES = Object.freeze([
  'contacts:read',
  'contacts:write',
  'contacts:social-links:correct',
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
] as const);

export type AgentScope = (typeof AGENT_SCOPES)[number];

export const AGENT_RISK_LEVELS = Object.freeze([
  'read',
  'automatic',
  'approval_required',
] as const);

export type AgentRiskLevel = (typeof AGENT_RISK_LEVELS)[number];

export const AGENT_ERROR_CODES = Object.freeze([
  'AUTHENTICATION_REQUIRED',
  'INSUFFICIENT_SCOPE',
  'INVALID_INPUT',
  'NOT_FOUND',
  'CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'APPROVAL_REQUIRED',
  'APPROVAL_INVALID',
  'ACTION_EXECUTION_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const);

export type AgentErrorCode = (typeof AGENT_ERROR_CODES)[number];

export const PROPOSAL_ACTION_TYPES = Object.freeze([
  'message',
  'introduction',
  'invitation',
  'merge',
  'delete',
] as const);

export type ProposalActionType = (typeof PROPOSAL_ACTION_TYPES)[number];

export interface AgentPrincipal {
  readonly ownerId: string;
  readonly clientId: string;
  readonly credentialId: string;
  readonly clientName: string;
  readonly scopes: readonly AgentScope[];
}

export interface AgentToolMetadata {
  readonly name: string;
  readonly description: string;
  readonly requiredScope: AgentScope;
  readonly risk: AgentRiskLevel;
  readonly requiresIdempotencyKey: boolean;
}

export type AgentErrorDetails = Readonly<
  Record<string, string | number | boolean | null>
>;

export interface AgentPublicError {
  readonly code: AgentErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: AgentErrorDetails;
}

export interface AgentResultSuccess<T> {
  readonly ok: true;
  readonly data: T;
}

export interface AgentResultFailure {
  readonly ok: false;
  readonly error: AgentPublicError;
}

export type AgentResult<T> = AgentResultSuccess<T> | AgentResultFailure;
export type AgentToolResult<T> = AgentResult<T>;

export interface AgentBriefAcceptInput {
  readonly itemId: string;
  readonly idempotencyKey: string;
  readonly action: 'accept';
}

export interface AgentBriefSnoozeInput {
  readonly itemId: string;
  readonly idempotencyKey: string;
  readonly action: 'snooze';
  readonly snoozedUntil: string;
}

export interface AgentBriefDismissInput {
  readonly itemId: string;
  readonly idempotencyKey: string;
  readonly action: 'dismiss';
  readonly reason?: string;
}

export type AgentBriefFeedbackInput =
  | AgentBriefAcceptInput
  | AgentBriefSnoozeInput
  | AgentBriefDismissInput;

export type AgentQuestCompletionInput =
  | {
      readonly questId: string;
      readonly idempotencyKey: string;
      readonly interactionId: string;
    }
  | {
      readonly questId: string;
      readonly idempotencyKey: string;
      readonly reminderId: string;
    };

export interface MessageProposalPayload {
  readonly contactId: string;
  readonly channel: 'email' | 'sms' | 'social' | 'other';
  readonly body: string;
}

export interface IntroductionProposalPayload {
  readonly contactId: string;
  readonly otherContactId: string;
  readonly context?: string;
}

export interface InvitationProposalPayload {
  readonly contactId: string;
  readonly title: string;
  readonly scheduledAt?: string;
}

export interface MergeProposalPayload {
  readonly sourceContactId: string;
  readonly targetContactId: string;
}

export interface DeleteProposalPayload {
  readonly entityType: 'contact' | 'interaction' | 'reminder';
  readonly entityId: string;
}

export type AgentActionProposalInput =
  | {
      readonly actionType: 'message';
      readonly idempotencyKey: string;
      readonly payload: MessageProposalPayload;
    }
  | {
      readonly actionType: 'introduction';
      readonly idempotencyKey: string;
      readonly payload: IntroductionProposalPayload;
    }
  | {
      readonly actionType: 'invitation';
      readonly idempotencyKey: string;
      readonly payload: InvitationProposalPayload;
    }
  | {
      readonly actionType: 'merge';
      readonly idempotencyKey: string;
      readonly payload: MergeProposalPayload;
    }
  | {
      readonly actionType: 'delete';
      readonly idempotencyKey: string;
      readonly payload: DeleteProposalPayload;
    };

export type AgentApprovedActionInput =
  | {
      readonly grantId: string;
      readonly actionType: 'message';
      readonly idempotencyKey: string;
      readonly payload: MessageProposalPayload;
    }
  | {
      readonly grantId: string;
      readonly actionType: 'introduction';
      readonly idempotencyKey: string;
      readonly payload: IntroductionProposalPayload;
    }
  | {
      readonly grantId: string;
      readonly actionType: 'invitation';
      readonly idempotencyKey: string;
      readonly payload: InvitationProposalPayload;
    }
  | {
      readonly grantId: string;
      readonly actionType: 'merge';
      readonly idempotencyKey: string;
      readonly payload: MergeProposalPayload;
    }
  | {
      readonly grantId: string;
      readonly actionType: 'delete';
      readonly idempotencyKey: string;
      readonly payload: DeleteProposalPayload;
    };
