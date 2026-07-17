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
  scopes: ["interactions:write", "reminders:write", "feedback:write"],
};

function harness() {
  const reads = {
    briefToday: jest.fn(),
    contactsSearch: jest.fn(),
    relationshipHealth: jest.fn(),
    importantDates: jest.fn(),
    remindersList: jest.fn(),
  };
  const interactions = { createForAgent: jest.fn() };
  const reminders = { createForAgent: jest.fn(), create: jest.fn() };
  const feedback = {
    recordItemFeedbackForAgent: jest.fn(),
    completeQuestForAgent: jest.fn(),
  };
  const proposals = { createProposal: jest.fn() };
  const executions = { execute: jest.fn() };
  return {
    handlers: new AgentToolHandlers(
      reads as never,
      interactions,
      reminders,
      feedback,
      proposals as never,
      executions as never
    ),
    reads,
    interactions,
    reminders,
    feedback,
    proposals,
    executions,
  };
}

describe("AgentToolHandlers", () => {
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
