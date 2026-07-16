import {
  agentActionProposalInputSchema,
  type AgentActionProposalInput,
  type ProposalActionType,
} from "@socos/agent-core";

const UNAVAILABLE_PREVIEW = {
  type: "unavailable" as const,
  label: "Unavailable preview" as const,
};

export interface ProposalHistoryRecord {
  id: string;
  actionType: string;
  preview: unknown;
  status: string;
  expiresAt: Date;
  decidedAt: Date | null;
  createdAt: Date;
  client: { id: string; name: string };
  grant: {
    status: string;
    expiresAt: Date;
    consumedAt: Date | null;
    revokedAt: Date | null;
    outbox: {
      status: string;
      attempts: number;
      completedAt: Date | null;
      lastErrorCode: string | null;
    } | null;
  } | null;
}

export interface ProposalHistoryContact {
  id: string;
  firstName: string;
  lastName: string | null;
}

export function collectProposalContactIds(
  proposals: ProposalHistoryRecord[]
): string[] {
  const ids = new Set<string>();
  for (const proposal of proposals) {
    const input = parsePreview(proposal.actionType, proposal.preview);
    if (!input) continue;
    if (input.actionType === "message" || input.actionType === "invitation") {
      ids.add(input.payload.contactId);
    } else if (input.actionType === "introduction") {
      ids.add(input.payload.contactId);
      ids.add(input.payload.otherContactId);
    } else if (input.actionType === "merge") {
      ids.add(input.payload.sourceContactId);
      ids.add(input.payload.targetContactId);
    } else if (input.payload.entityType === "contact") {
      ids.add(input.payload.entityId);
    }
  }
  return [...ids];
}

export function presentProposalHistory(
  proposals: ProposalHistoryRecord[],
  contacts: ProposalHistoryContact[],
  total: number,
  offset: number,
  limit: number
) {
  const contactsById = new Map(
    contacts.map((contact) => [contact.id, contact])
  );
  return {
    proposals: proposals.map((proposal) => ({
      id: proposal.id,
      actionType: proposal.actionType as ProposalActionType,
      preview: presentPreview(proposal, contactsById),
      status: proposal.status,
      expiresAt: proposal.expiresAt,
      decidedAt: proposal.decidedAt,
      createdAt: proposal.createdAt,
      client: proposal.client,
      grant: proposal.grant
        ? {
            status: proposal.grant.status,
            expiresAt: proposal.grant.expiresAt,
            consumedAt: proposal.grant.consumedAt,
            revokedAt: proposal.grant.revokedAt,
            outbox: proposal.grant.outbox
              ? {
                  status: proposal.grant.outbox.status,
                  attempts: proposal.grant.outbox.attempts,
                  completedAt: proposal.grant.outbox.completedAt,
                  lastErrorCode: proposal.grant.outbox.lastErrorCode,
                }
              : null,
          }
        : null,
    })),
    total,
    offset,
    limit,
  };
}

function parsePreview(
  actionType: string,
  preview: unknown
): AgentActionProposalInput | null {
  const result = agentActionProposalInputSchema.safeParse({
    actionType,
    idempotencyKey: "history:preview",
    payload: preview,
  });
  return result.success ? result.data : null;
}

function presentPreview(
  proposal: ProposalHistoryRecord,
  contacts: Map<string, ProposalHistoryContact>
) {
  const input = parsePreview(proposal.actionType, proposal.preview);
  if (!input) return UNAVAILABLE_PREVIEW;

  if (input.actionType === "message") {
    return {
      type: "message" as const,
      contact: contactReference(input.payload.contactId, contacts),
      channel: input.payload.channel,
      body: input.payload.body,
    };
  }
  if (input.actionType === "introduction") {
    return {
      type: "introduction" as const,
      contact: contactReference(input.payload.contactId, contacts),
      otherContact: contactReference(input.payload.otherContactId, contacts),
      context: input.payload.context ?? null,
    };
  }
  if (input.actionType === "invitation") {
    return {
      type: "invitation" as const,
      contact: contactReference(input.payload.contactId, contacts),
      title: input.payload.title,
      scheduledAt: input.payload.scheduledAt ?? null,
    };
  }
  if (input.actionType === "merge") {
    return {
      type: "merge" as const,
      sourceContact: contactReference(input.payload.sourceContactId, contacts),
      targetContact: contactReference(input.payload.targetContactId, contacts),
    };
  }

  const { entityType, entityId } = input.payload;
  const label =
    entityType === "contact"
      ? contactReference(entityId, contacts).name
      : entityType === "interaction"
        ? "Interaction record"
        : "Reminder record";
  return { type: "delete" as const, entityType, entityId, label };
}

function contactReference(
  id: string,
  contacts: Map<string, ProposalHistoryContact>
) {
  const contact = contacts.get(id);
  if (!contact) return { id, name: "Unavailable contact" };
  return {
    id,
    name:
      [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
      "Unavailable contact",
  };
}
