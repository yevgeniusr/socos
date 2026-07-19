import type { AgentPrincipal } from "@socos/agent-core";
import { hashCanonicalJson } from "../agent-security/canonical-json.js";
import { InteractionType } from "../interactions/interactions.dto.js";
import { ReminderType } from "../reminders/reminders.dto.js";
import { AgentToolHandlers } from "./tool-handlers.js";

const principal: AgentPrincipal = {
  ownerId: "owner-synthetic",
  clientId: "client-synthetic",
  credentialId: "credential-synthetic",
  clientName: "Hermes Synthetic",
  scopes: [
    "contacts:write",
    "contacts:social-links:correct",
    "interactions:write",
    "reminders:write",
    "feedback:write",
    "enrichment:candidates:write",
    "enrichment:accept",
  ],
};

function harness() {
  const reads = {
    briefToday: jest.fn(),
    contactsSearch: jest.fn(),
    relationshipHealth: jest.fn(),
    importantDates: jest.fn(),
    remindersList: jest.fn(),
    contactsMissingEnrichment: jest.fn(),
    enrichmentCandidatesList: jest.fn(),
  };
  const contacts = { createForAgent: jest.fn() };
  const interactions = { createForAgent: jest.fn() };
  const reminders = { createForAgent: jest.fn(), create: jest.fn() };
  const feedback = {
    recordItemFeedbackForAgent: jest.fn(),
    completeQuestForAgent: jest.fn(),
  };
  const proposals = { createProposal: jest.fn() };
  const executions = { execute: jest.fn() };
  const enrichment = {
    listCandidates: jest.fn(),
    submitCandidate: jest.fn(),
    acceptCandidate: jest.fn(),
    correctSocialLink: jest.fn(),
  };
  return {
    handlers: new AgentToolHandlers(
      reads as never,
      contacts,
      interactions,
      reminders,
      feedback,
      proposals as never,
      executions as never,
      enrichment as never
    ),
    reads,
    contacts,
    interactions,
    reminders,
    feedback,
    proposals,
    executions,
    enrichment,
  };
}

describe("AgentToolHandlers", () => {
  it("creates contacts through the transaction-aware owner-scoped seam", async () => {
    const { handlers, contacts } = harness();
    const transaction = { id: "tx" } as never;
    contacts.createForAgent.mockResolvedValue({
      id: "contact-aushman",
      firstName: "Aushman",
      lastName: null,
      nickname: null,
      labels: ["second-brain"],
      tags: ["historical-game-event-participant"],
      groups: [],
      createdAt: "2026-07-19T00:00:00.000Z",
    });

    await expect(
      handlers.createContact(
        principal,
        {
          idempotencyKey: "contact:create-aushman",
          firstName: "Aushman",
          labels: ["second-brain"],
          tags: ["historical-game-event-participant"],
        },
        transaction
      )
    ).resolves.toMatchObject({ id: "contact-aushman", firstName: "Aushman" });
    expect(contacts.createForAgent).toHaveBeenCalledWith(
      principal.ownerId,
      {
        firstName: "Aushman",
        labels: ["second-brain"],
        tags: ["historical-game-event-participant"],
      },
      transaction
    );
  });

  it("submits and accepts candidates through the idempotency transaction", async () => {
    const { handlers, enrichment } = harness();
    const transaction = { id: "tx" } as never;
    const row = {
      id: "candidate-synthetic",
      contactId: "contact-synthetic",
      fieldName: "company",
      proposedValue: "Synthetic Labs",
      correctionKind: null,
      previousValue: null,
      sourceKind: "second_brain",
      sourceLocator: "people/synthetic-person.md",
      sourceReference: null,
      sourceRetrievedAt: new Date("2026-07-18T10:00:00.000Z"),
      confidence: 0.98,
      matchRationale: "Exact full-name and labeled field.",
      status: "pending",
      contentHash: "a".repeat(64),
      decidedAt: null,
      appliedAt: null,
      createdAt: new Date("2026-07-18T10:00:00.000Z"),
      updatedAt: new Date("2026-07-18T10:00:00.000Z"),
    };
    enrichment.submitCandidate.mockResolvedValue({
      candidate: row,
      deduplicated: false,
    });
    enrichment.acceptCandidate.mockResolvedValue({
      candidateId: row.id,
      contactId: row.contactId,
      fieldName: row.fieldName,
      status: "accepted",
      applied: true,
      appliedAt: "2026-07-18T10:05:00.000Z",
    });

    await expect(
      handlers.submitEnrichmentCandidate(
        principal,
        {
          idempotencyKey: "candidate:intent-001",
          contactId: row.contactId,
          fieldName: "company",
          proposedValue: "Synthetic Labs",
          sourceKind: "second_brain",
          sourceLocator: row.sourceLocator,
          sourceRetrievedAt: "2026-07-18T10:00:00.000Z",
          confidence: 0.98,
          matchRationale: row.matchRationale,
        },
        transaction
      )
    ).resolves.toMatchObject({
      deduplicated: false,
      candidate: {
        id: row.id,
        correctionKind: null,
        sourceRetrievedAt: "2026-07-18T10:00:00.000Z",
      },
    });
    await handlers.acceptEnrichmentCandidate(
      principal,
      {
        idempotencyKey: "candidate:accept-001",
        candidateId: row.id,
      },
      transaction
    );

    expect(enrichment.submitCandidate).toHaveBeenCalledWith(
      principal.ownerId,
      expect.not.objectContaining({ idempotencyKey: expect.anything() }),
      transaction
    );
    expect(enrichment.acceptCandidate).toHaveBeenCalledWith(
      principal.ownerId,
      row.id,
      transaction
    );
  });

  it("redacts stored previous values from public candidate-list presentation", async () => {
    const { handlers, enrichment } = harness();
    enrichment.listCandidates.mockResolvedValue({
      candidates: [
        {
          id: "candidate-correction",
          contactId: "contact-synthetic",
          fieldName: "socialLinks",
          proposedValue: {
            linkedin: "https://www.linkedin.com/in/correct-person/",
            github: "https://github.com/synthetic-person",
          },
          correctionKind: "social_link_replace",
          previousValue: {
            linkedin: "https://www.linkedin.com/in/old-person/",
          },
          sourceKind: "second_brain",
          sourceLocator: "people/synthetic-person.md",
          sourceReference: "old URL https://www.linkedin.com/in/old-person/",
          sourceRetrievedAt: new Date("2026-07-19T11:45:00.000Z"),
          confidence: 0.99,
          matchRationale:
            "Owner said https://www.linkedin.com/in/old-person/ was stale.",
          status: "accepted",
          contentHash: "b".repeat(64),
          decidedAt: new Date("2026-07-19T12:00:00.000Z"),
          appliedAt: new Date("2026-07-19T12:00:00.000Z"),
          createdAt: new Date("2026-07-19T11:50:00.000Z"),
          updatedAt: new Date("2026-07-19T12:00:00.000Z"),
        },
      ],
      total: 1,
      offset: 0,
      limit: 20,
    });

    const result = await handlers.enrichmentCandidatesList(principal, {
      contactId: "contact-synthetic",
      offset: 0,
      limit: 20,
    });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("previousValue");
    expect(serialized).not.toContain("old-person");
    expect(serialized).toContain("correct-person");
  });

  it("corrects an existing social link through the transaction-aware owner-scoped seam", async () => {
    const { handlers, enrichment } = harness();
    const transaction = { id: "tx" } as never;
    enrichment.correctSocialLink.mockResolvedValue({
      contactId: "contact-synthetic",
      socialKey: "linkedin",
      status: "accepted",
      applied: true,
      correctedValue: "https://www.linkedin.com/in/correct-person/",
      appliedAt: "2026-07-19T12:00:00.000Z",
      provenance: {
        candidateId: "candidate-correction",
        sourceKind: "second_brain",
        sourceLocator: "people/synthetic-person.md",
        sourceReference: "frontmatter: linkedin",
        sourceRetrievedAt: "2026-07-19T11:45:00.000Z",
        confidence: 0.99,
      },
    });

    await expect(
      handlers.correctContactSocialLink(
        principal,
        {
          idempotencyKey: "contact-social-link:correct-001",
          contactId: "contact-synthetic",
          socialKey: "linkedin",
          expectedCurrentValue: "https://www.linkedin.com/in/old-person/",
          correctedValue: "https://www.linkedin.com/in/correct-person/",
          sourceKind: "second_brain",
          sourceLocator: "people/synthetic-person.md",
          sourceReference: "frontmatter: linkedin",
          sourceRetrievedAt: "2026-07-19T11:45:00.000Z",
          confidence: 0.99,
          matchRationale:
            "Owner explicitly identified the existing LinkedIn URL as incorrect.",
        },
        transaction
      )
    ).resolves.toMatchObject({
      contactId: "contact-synthetic",
      socialKey: "linkedin",
      applied: true,
      provenance: { candidateId: "candidate-correction" },
    });

    expect(enrichment.correctSocialLink).toHaveBeenCalledWith(
      principal.ownerId,
      expect.not.objectContaining({ idempotencyKey: expect.anything() }),
      transaction
    );
  });
  it("uses the transaction-aware interaction seam and least-privilege presenter", async () => {
    const { handlers, interactions } = harness();
    const transaction = { id: "tx" } as never;
    const receipt = {
      interaction: {
        id: "interaction-synthetic",
        contactId: "contact-synthetic",
        type: "call",
        title: null,
        content: "Private content",
        summary: null,
        occurredAt: "2026-07-16T12:00:00.000Z",
        duration: null,
        location: null,
        xpEarned: 10,
        createdAt: "2026-07-16T12:00:00.000Z",
      },
      lastContact: {
        previousAt: null,
        resultingAt: "2026-07-16T12:00:00.000Z",
        advanced: true,
      },
      xp: {
        interactionDelta: 10,
        achievementDelta: 0,
        totalDelta: 10,
        totalAfter: 100,
        levelAfter: 2,
      },
      outcome: "Recorded only; nothing sent",
      createdAt: "2026-07-16T12:00:00.000Z",
    };
    interactions.createForAgent.mockResolvedValue(receipt);
    const input = {
      idempotencyKey: "interaction:intent-001",
      contactId: "contact-synthetic",
      type: InteractionType.CALL,
      content: "Private content",
    };

    await expect(
      handlers.logInteraction(principal, input, transaction)
    ).resolves.toEqual(receipt);
    expect(interactions.createForAgent).toHaveBeenCalledWith(
      principal.ownerId,
      {
        contactId: input.contactId,
        type: input.type,
        content: input.content,
      },
      transaction
    );
  });

  it("returns the exact durable receipt envelope for agent interaction writes", async () => {
    const { handlers, interactions } = harness();
    const receipt = {
      interaction: {
        id: "interaction-synthetic",
        contactId: "contact-synthetic",
        type: "call",
        title: null,
        content: null,
        summary: null,
        occurredAt: "2026-07-16T12:00:00.000Z",
        duration: null,
        location: null,
        xpEarned: 10,
        createdAt: "2026-07-16T12:00:00.000Z",
      },
      lastContact: {
        previousAt: null,
        resultingAt: "2026-07-16T12:00:00.000Z",
        advanced: true,
      },
      xp: {
        interactionDelta: 10,
        achievementDelta: 0,
        totalDelta: 10,
        totalAfter: 100,
        levelAfter: 2,
      },
      outcome: "Recorded only; nothing sent",
      createdAt: "2026-07-16T12:00:00.000Z",
    };
    interactions.createForAgent.mockResolvedValue(receipt);

    await expect(
      handlers.logInteraction(
        principal,
        {
          idempotencyKey: "interaction:intent-002",
          contactId: "contact-synthetic",
          type: InteractionType.CALL,
        },
        { id: "tx" } as never
      )
    ).resolves.toEqual(receipt);
  });

  it("uses createForAgent for reminders and never the outbound-capable legacy create", async () => {
    const { handlers, reminders } = harness();
    const transaction = { id: "tx" } as never;
    reminders.createForAgent.mockResolvedValue({
      reminderId: "reminder-synthetic",
      contactId: "contact-synthetic",
      type: "followup",
      title: "Private title",
      scheduledAt: new Date("2026-07-20T12:00:00.000Z"),
      status: "pending",
    });
    const input = {
      idempotencyKey: "reminder:intent-001",
      contactId: "contact-synthetic",
      type: ReminderType.FOLLOWUP,
      title: "Private title",
      scheduledAt: "2026-07-20T12:00:00.000Z",
    };

    await expect(
      handlers.createReminder(principal, input, transaction)
    ).resolves.toEqual({
      reminderId: "reminder-synthetic",
      contactId: "contact-synthetic",
      type: "followup",
      scheduledAt: "2026-07-20T12:00:00.000Z",
      status: "pending",
    });
    expect(reminders.createForAgent).toHaveBeenCalledWith(
      principal.ownerId,
      expect.not.objectContaining({ idempotencyKey: expect.anything() }),
      transaction
    );
    expect(reminders.create).not.toHaveBeenCalled();
  });

  it("uses transaction-aware feedback and quest adapter methods", async () => {
    const { handlers, feedback } = harness();
    const transaction = { id: "tx" } as never;
    feedback.recordItemFeedbackForAgent.mockResolvedValue({
      feedbackId: "feedback-synthetic",
      itemId: "item-synthetic",
      action: "accept",
      status: "accepted",
      reason: null,
      snoozedUntil: null,
    });
    feedback.completeQuestForAgent.mockResolvedValue({
      feedbackId: "completion-synthetic",
      questId: "quest-synthetic",
      status: "completed",
      completedAt: new Date("2026-07-16T12:00:00.000Z"),
      xpAwarded: 20,
    });

    await handlers.briefFeedback(
      principal,
      {
        itemId: "item-synthetic",
        idempotencyKey: "feedback:intent-001",
        action: "accept",
      },
      transaction
    );
    await handlers.completeQuest(
      principal,
      {
        questId: "quest-synthetic",
        idempotencyKey: "quest:intent-001",
        interactionId: "interaction-synthetic",
      },
      transaction
    );

    expect(feedback.recordItemFeedbackForAgent).toHaveBeenCalledWith(
      principal.ownerId,
      "item-synthetic",
      `agent:${hashCanonicalJson([
        principal.clientId,
        "socos_brief_feedback",
        "feedback:intent-001",
        {
          itemId: "item-synthetic",
          idempotencyKey: "feedback:intent-001",
          action: "accept",
        },
      ])}`,
      { action: "accept" },
      transaction
    );
    expect(feedback.completeQuestForAgent).toHaveBeenCalledWith(
      principal.ownerId,
      "quest-synthetic",
      `agent:${hashCanonicalJson([
        principal.clientId,
        "socos_complete_quest",
        "quest:intent-001",
        {
          questId: "quest-synthetic",
          idempotencyKey: "quest:intent-001",
          interactionId: "interaction-synthetic",
        },
      ])}`,
      { interactionId: "interaction-synthetic" },
      transaction
    );
  });

  it("passes proposal creation the idempotency transaction and strips ownership", async () => {
    const { handlers, proposals } = harness();
    const transaction = { id: "tx" } as never;
    const input = {
      actionType: "message" as const,
      idempotencyKey: "proposal:intent-001",
      payload: {
        contactId: "contact-synthetic",
        channel: "email" as const,
        body: "Private draft",
      },
    };
    proposals.createProposal.mockResolvedValue({
      id: "proposal-synthetic",
      ownerId: principal.ownerId,
      clientId: principal.clientId,
      actionType: "message",
      riskLevel: "approval_required",
      payloadHash: "a".repeat(64),
      preview: input.payload,
      status: "pending",
      expiresAt: new Date("2026-07-17T12:00:00.000Z"),
      createdAt: new Date("2026-07-16T12:00:00.000Z"),
    });

    await expect(
      handlers.proposeAction(principal, input, transaction)
    ).resolves.toEqual({
      proposalId: "proposal-synthetic",
      actionType: "message",
      riskLevel: "approval_required",
      preview: input.payload,
      status: "pending",
      expiresAt: "2026-07-17T12:00:00.000Z",
      createdAt: "2026-07-16T12:00:00.000Z",
    });
    expect(proposals.createProposal).toHaveBeenCalledWith(
      principal,
      input,
      transaction
    );
  });

  it("passes approved execution through the bound transaction and preserves stable errors", async () => {
    const { handlers, executions } = harness();
    const transaction = { id: "tx" } as never;
    const input = {
      grantId: "grant-synthetic",
      actionType: "message" as const,
      idempotencyKey: "execute:message:001",
      payload: {
        contactId: "contact-synthetic",
        channel: "social" as const,
        body: "Synthetic approved draft",
      },
    };
    executions.execute.mockResolvedValue({
      ok: false,
      error: {
        code: "ACTION_EXECUTION_UNAVAILABLE",
        message: "No approved executor is available for this action.",
        retryable: false,
      },
    });

    await expect(
      handlers.executeApprovedAction(principal, input, transaction)
    ).rejects.toMatchObject({
      publicError: { code: "ACTION_EXECUTION_UNAVAILABLE" },
    });
    expect(executions.execute).toHaveBeenCalledWith(
      principal,
      input,
      transaction
    );
  });
});
