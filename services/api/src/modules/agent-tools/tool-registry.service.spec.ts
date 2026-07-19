import { NotFoundException } from "@nestjs/common";
import type { AgentPrincipal } from "@socos/agent-core";
import type { AgentAuditService } from "../agent-security/agent-audit.service.js";
import type { AgentIdempotencyService } from "../agent-security/agent-idempotency.service.js";
import {
  AgentHandlerError,
  type AgentToolHandlers,
} from "./tool-handlers.js";
import { AgentToolRegistryService } from "./tool-registry.service.js";

const principal: AgentPrincipal = {
  ownerId: "owner-synthetic",
  clientId: "client-synthetic",
  credentialId: "credential-synthetic",
  clientName: "Hermes Synthetic",
  scopes: [
    "briefs:read",
    "enrichment:read",
    "contacts:read",
    "contacts:write",
    "relationships:read",
    "dates:read",
    "reminders:read",
    "interactions:write",
    "reminders:write",
    "feedback:write",
    "quests:complete",
    "proposals:write",
    "enrichment:candidates:write",
    "enrichment:accept",
    "approvals:execute",
  ],
};

function harness() {
  const transaction = { transaction: "synthetic" };
  const handlers = {
    briefToday: jest.fn().mockResolvedValue({ status: "BRIEF_NOT_READY" }),
    contactsSearch: jest.fn().mockResolvedValue({ contacts: [] }),
    createContact: jest.fn().mockResolvedValue({
      id: "contact-created",
      firstName: "Synthetic",
      lastName: "Person",
    }),
    relationshipHealth: jest.fn(),
    importantDates: jest.fn(),
    remindersList: jest.fn(),
    contactsMissingEnrichment: jest.fn(),
    enrichmentCandidatesList: jest.fn(),
    submitEnrichmentCandidate: jest.fn(),
    acceptEnrichmentCandidate: jest.fn(),
    logInteraction: jest
      .fn()
      .mockResolvedValue({ interactionId: "interaction-synthetic" }),
    createReminder: jest.fn(),
    briefFeedback: jest.fn(),
    completeQuest: jest.fn(),
    proposeAction: jest.fn(),
    executeApprovedAction: jest.fn(),
    dynamicallyDiscovered: jest.fn(),
  };
  const idempotency = {
    execute: jest
      .fn()
      .mockImplementation((_principal, _operation, _key, _request, execute) =>
        execute(transaction)
      ),
  };
  const audit = { record: jest.fn().mockResolvedValue({ id: "audit-1" }) };
  const registry = new AgentToolRegistryService(
    handlers as unknown as AgentToolHandlers,
    idempotency as unknown as AgentIdempotencyService,
    audit as unknown as AgentAuditService
  );
  return { registry, handlers, idempotency, audit, transaction };
}

describe("AgentToolRegistryService", () => {
  it("lists exactly the sixteen tools in stable explicit order", () => {
    const { registry } = harness();

    expect(registry.list()).toEqual([
      metadata("socos_brief_today", "briefs:read", "read", false),
      metadata("socos_contacts_search", "contacts:read", "read", false),
      metadata("socos_create_contact", "contacts:write", "automatic", true),
      metadata(
        "socos_relationship_health",
        "relationships:read",
        "read",
        false
      ),
      metadata("socos_important_dates", "dates:read", "read", false),
      metadata("socos_reminders_list", "reminders:read", "read", false),
      metadata(
        "socos_contacts_missing_enrichment",
        "enrichment:read",
        "read",
        false
      ),
      metadata(
        "socos_enrichment_candidates_list",
        "enrichment:read",
        "read",
        false
      ),
      metadata(
        "socos_log_interaction",
        "interactions:write",
        "automatic",
        true
      ),
      metadata("socos_create_reminder", "reminders:write", "automatic", true),
      metadata("socos_brief_feedback", "feedback:write", "automatic", true),
      metadata("socos_complete_quest", "quests:complete", "automatic", true),
      metadata(
        "socos_enrichment_candidate_submit",
        "enrichment:candidates:write",
        "automatic",
        true
      ),
      metadata(
        "socos_enrichment_candidate_accept",
        "enrichment:accept",
        "automatic",
        true
      ),
      metadata(
        "socos_propose_action",
        "proposals:write",
        "approval_required",
        true
      ),
      metadata(
        "socos_execute_approved_action",
        "approvals:execute",
        "approval_required",
        true
      ),
    ]);
    expect(
      registry.list().some((tool) => tool.name === "dynamicallyDiscovered")
    ).toBe(false);
  });

  it("exposes read-only strict schemas without exposing handlers", () => {
    const { registry } = harness();

    const definitions = registry.definitions();
    const search = registry.getDefinition("socos_contacts_search");

    expect(definitions).toHaveLength(16);
    expect(Object.isFrozen(definitions)).toBe(true);
    expect(search?.metadata.name).toBe("socos_contacts_search");
    expect(search?.inputSchema.safeParse({ query: "Synthetic" }).success).toBe(
      true
    );
    expect(
      search?.inputSchema.safeParse({
        query: "Synthetic",
        ownerId: "caller-owner",
      }).success
    ).toBe(false);
    expect(search).not.toHaveProperty("handler");
    expect(registry.getDefinition("socos_unknown")).toBeNull();
  });

  it("filters discovery definitions by server-resolved principal scope", () => {
    const { registry } = harness();
    const briefsOnly = { ...principal, scopes: ["briefs:read"] as const };

    const definitions = registry.definitions(briefsOnly);

    expect(definitions.map(({ metadata }) => metadata.name)).toEqual([
      "socos_brief_today",
    ]);
    expect(registry.definitions()).toHaveLength(16);
  });

  it("publishes a strict idempotent contact-creation schema", () => {
    const { registry } = harness();
    const create = registry.getDefinition("socos_create_contact")!;

    expect(create.metadata.requiredScope).toBe("contacts:write");
    expect(create.metadata.requiresIdempotencyKey).toBe(true);
    expect(
      create.inputSchema.safeParse({
        idempotencyKey: "contact:create-aushman",
        firstName: "Aushman",
        labels: ["second-brain"],
        tags: ["historical-game-event-participant"],
      }).success
    ).toBe(true);
    expect(
      create.inputSchema.safeParse({
        idempotencyKey: "contact:create-invalid",
        firstName: "Aushman",
        ownerId: "caller-controlled",
      }).success
    ).toBe(false);
  });

  it("publishes strict bounded enrichment schemas with idempotent writes", () => {
    const { registry } = harness();
    const missing = registry.getDefinition(
      "socos_contacts_missing_enrichment"
    )!;
    const submit = registry.getDefinition("socos_enrichment_candidate_submit")!;
    const accept = registry.getDefinition("socos_enrichment_candidate_accept")!;

    expect(missing.inputSchema.safeParse({}).success).toBe(true);
    expect(missing.inputSchema.safeParse({ limit: 101 }).success).toBe(false);
    expect(submit.metadata.requiresIdempotencyKey).toBe(true);
    expect(accept.metadata.requiresIdempotencyKey).toBe(true);
    expect(
      submit.inputSchema.safeParse({
        idempotencyKey: "candidate:intent-001",
        contactId: "contact-synthetic",
        fieldName: "company",
        proposedValue: "Synthetic Labs",
        sourceKind: "second_brain",
        sourceLocator: "people/synthetic-person.md",
        sourceRetrievedAt: "2026-07-18T10:00:00.000Z",
        confidence: 0.98,
        matchRationale: "Exact full-name match and labeled field.",
      }).success
    ).toBe(true);
    expect(
      accept.inputSchema.safeParse({
        idempotencyKey: "candidate:accept-001",
        candidateId: "candidate-synthetic",
        ownerId: "caller-controlled",
      }).success
    ).toBe(false);
  });

  it("filters enrichment discovery by each narrow server-owned scope", () => {
    const { registry } = harness();

    expect(
      registry
        .definitions({ ...principal, scopes: ["enrichment:read"] })
        .map(({ metadata }) => metadata.name)
    ).toEqual([
      "socos_contacts_missing_enrichment",
      "socos_enrichment_candidates_list",
    ]);
    expect(
      registry
        .definitions({
          ...principal,
          scopes: ["enrichment:candidates:write"],
        })
        .map(({ metadata }) => metadata.name)
    ).toEqual(["socos_enrichment_candidate_submit"]);
    expect(
      registry
        .definitions({ ...principal, scopes: ["enrichment:accept"] })
        .map(({ metadata }) => metadata.name)
    ).toEqual(["socos_enrichment_candidate_accept"]);
  });

  it("requires a repeat interval exactly for recurring reminders", () => {
    const { registry } = harness();
    const schema = registry.getDefinition("socos_create_reminder")!.inputSchema;
    const base = {
      idempotencyKey: "reminder:intent-001",
      contactId: "contact-synthetic",
      type: "followup",
      title: "Synthetic reminder",
      scheduledAt: "2026-07-20T12:00:00.000Z",
    };

    expect(
      schema.safeParse({
        ...base,
        isRecurring: true,
        repeatInterval: "weekly",
      }).success
    ).toBe(true);
    expect(schema.safeParse({ ...base, isRecurring: true }).success).toBe(
      false
    );
    expect(
      schema.safeParse({
        ...base,
        isRecurring: false,
        repeatInterval: "weekly",
      }).success
    ).toBe(false);
  });

  it("fails closed for an unknown tool", async () => {
    const { registry, handlers } = harness();

    await expect(
      registry.call("socos_unknown", principal, {})
    ).resolves.toEqual(failure("NOT_FOUND", "Unknown agent tool.", false));
    expect(handlers.contactsSearch).not.toHaveBeenCalled();
  });

  it("checks server-owned scope before invoking a tool", async () => {
    const { registry, handlers } = harness();
    const readOnly = { ...principal, scopes: ["briefs:read"] as const };

    await expect(
      registry.call("socos_contacts_search", readOnly, {
        query: "Synthetic",
      })
    ).resolves.toEqual(
      failure("INSUFFICIENT_SCOPE", "Agent scope is insufficient.", false)
    );
    expect(handlers.contactsSearch).not.toHaveBeenCalled();
  });

  it("audits a mutation rejected for insufficient server-owned scope", async () => {
    const { registry, handlers, audit } = harness();
    const readOnly = { ...principal, scopes: ["briefs:read"] as const };

    await expect(
      registry.call("socos_log_interaction", readOnly, {
        idempotencyKey: "interaction:intent-scope-001",
        contactId: "contact-synthetic",
        type: "call",
      })
    ).resolves.toEqual(
      failure("INSUFFICIENT_SCOPE", "Agent scope is insufficient.", false)
    );
    expect(handlers.logInteraction).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      readOnly,
      expect.objectContaining({
        operation: "socos_log_interaction",
        outcome: "rejected",
        metadata: {
          errorCode: "INSUFFICIENT_SCOPE",
          riskLevel: "automatic",
        },
      })
    );
  });

  it.each(["ownerId", "clientId", "xpReward", "unknown"])(
    "strictly rejects caller field %s",
    async (field) => {
      const { registry, handlers } = harness();

      await expect(
        registry.call("socos_contacts_search", principal, {
          query: "Synthetic",
          [field]: field === "xpReward" ? 999 : "caller-controlled",
        })
      ).resolves.toEqual(
        failure("INVALID_INPUT", "Agent tool input is invalid.", false)
      );
      expect(handlers.contactsSearch).not.toHaveBeenCalled();
    }
  );

  it("audits strict-input rejection on a mutation without hashing private input", async () => {
    const { registry, handlers, audit } = harness();

    await expect(
      registry.call("socos_log_interaction", principal, {
        idempotencyKey: "interaction:intent-invalid-001",
        contactId: "contact-synthetic",
        type: "call",
        ownerId: "caller-controlled",
      })
    ).resolves.toEqual(
      failure("INVALID_INPUT", "Agent tool input is invalid.", false)
    );
    expect(handlers.logInteraction).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(principal, {
      operation: "socos_log_interaction",
      outcome: "rejected",
      metadata: { errorCode: "INVALID_INPUT", riskLevel: "automatic" },
    });
  });

  it("passes writes through idempotency and audits in the same transaction", async () => {
    const { registry, handlers, idempotency, audit, transaction } = harness();
    const input = {
      idempotencyKey: "interaction:intent-001",
      contactId: "contact-synthetic",
      type: "call",
    };

    await expect(
      registry.call("socos_log_interaction", principal, input)
    ).resolves.toEqual({
      ok: true,
      data: { interactionId: "interaction-synthetic" },
    });

    expect(idempotency.execute).toHaveBeenCalledWith(
      principal,
      "socos_log_interaction",
      input.idempotencyKey,
      input,
      expect.any(Function)
    );
    expect(handlers.logInteraction).toHaveBeenCalledWith(
      principal,
      input,
      transaction
    );
    expect(audit.record).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        operation: "socos_log_interaction",
        outcome: "succeeded",
        idempotencyKey: input.idempotencyKey,
        requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        metadata: { riskLevel: "automatic", replayed: false },
      }),
      transaction
    );
  });

  it("audits a cached idempotent replay without invoking the handler", async () => {
    const { registry, handlers, idempotency, audit } = harness();
    idempotency.execute.mockResolvedValue({
      ok: true,
      data: { interactionId: "interaction-existing" },
    });
    const input = {
      idempotencyKey: "interaction:intent-replay-001",
      contactId: "contact-synthetic",
      type: "call",
    };

    await registry.call("socos_log_interaction", principal, input);

    expect(handlers.logInteraction).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        operation: "socos_log_interaction",
        outcome: "succeeded",
        idempotencyKey: input.idempotencyKey,
        metadata: { riskLevel: "automatic", replayed: true },
      })
    );
  });

  it("audits an idempotency conflict returned before handler dispatch", async () => {
    const { registry, handlers, idempotency, audit } = harness();
    idempotency.execute.mockResolvedValue(
      failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key conflicts with an existing request.",
        false
      )
    );

    await registry.call("socos_log_interaction", principal, {
      idempotencyKey: "interaction:intent-conflict-001",
      contactId: "contact-synthetic",
      type: "call",
    });

    expect(handlers.logInteraction).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        outcome: "failed",
        metadata: {
          errorCode: "IDEMPOTENCY_CONFLICT",
          riskLevel: "automatic",
        },
      })
    );
  });

  it("sanitizes handler exceptions and audits only the stable error code", async () => {
    const { registry, handlers, idempotency, audit } = harness();
    const privateError = new NotFoundException(
      "Private contact details must not leak"
    );
    let callbackError: unknown;
    handlers.logInteraction.mockRejectedValue(privateError);
    idempotency.execute.mockImplementation(
      async (_principal, _operation, _key, _request, execute) => {
        try {
          return await execute({ transaction: "rollback-synthetic" });
        } catch (error) {
          callbackError = error;
          throw error;
        }
      }
    );

    await expect(
      registry.call("socos_log_interaction", principal, {
        idempotencyKey: "interaction:intent-002",
        contactId: "missing-contact",
        type: "call",
      })
    ).resolves.toEqual(
      failure("NOT_FOUND", "Requested resource was not found.", false)
    );
    expect(callbackError).toBe(privateError);
    expect(audit.record).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        outcome: "rejected",
        metadata: { errorCode: "NOT_FOUND", riskLevel: "automatic" },
      })
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(
      "Private contact details"
    );
  });

  it("preserves a stable approved-execution boundary error", async () => {
    const { registry, handlers, audit } = harness();
    handlers.executeApprovedAction.mockRejectedValue(
      new AgentHandlerError({
        code: "ACTION_EXECUTION_UNAVAILABLE",
        message: "No approved executor is available for this action.",
        retryable: false,
      })
    );

    await expect(
      registry.call("socos_execute_approved_action", principal, {
        grantId: "grant-synthetic",
        actionType: "message",
        idempotencyKey: "execute:message:001",
        payload: {
          contactId: "contact-synthetic",
          channel: "social",
          body: "Synthetic approved draft",
        },
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "ACTION_EXECUTION_UNAVAILABLE",
        message: "No approved executor is available for this action.",
        retryable: false,
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        operation: "socos_execute_approved_action",
        actionType: "message",
        metadata: expect.objectContaining({
          errorCode: "ACTION_EXECUTION_UNAVAILABLE",
        }),
      })
    );
  });
});

function metadata(
  name: string,
  requiredScope: string,
  risk: string,
  requiresIdempotencyKey: boolean
) {
  return {
    name,
    description: expect.any(String),
    requiredScope,
    risk,
    requiresIdempotencyKey,
  };
}

function failure(code: string, message: string, retryable: boolean) {
  return { ok: false, error: { code, message, retryable } };
}
