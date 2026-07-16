import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import type { AgentPrincipal, AgentScope } from "@socos/agent-core";
import { AgentAuthService } from "../src/modules/agent-auth/agent-auth.service.js";
import { AgentAuditService } from "../src/modules/agent-security/agent-audit.service.js";
import { AgentIdempotencyService } from "../src/modules/agent-security/agent-idempotency.service.js";
import { ActionProposalService } from "../src/modules/agent-security/action-proposal.service.js";
import {
  ApprovedActionExecutionService,
  type ApprovedActionExecutor,
} from "../src/modules/agent-security/approved-action-execution.service.js";
import type { GamificationService } from "../src/modules/gamification/gamification.service.js";
import { InteractionsService } from "../src/modules/interactions/interactions.service.js";
import { PrismaService } from "../src/modules/prisma/prisma.service.js";
import type { AgentReadService } from "../src/modules/agent-tools/agent-read.service.js";
import {
  AgentToolHandlers,
  type AgentFeedbackCommands,
  type AgentReminderCommands,
} from "../src/modules/agent-tools/tool-handlers.js";
import { AgentToolRegistryService } from "../src/modules/agent-tools/tool-registry.service.js";

jest.setTimeout(45_000);

const synthetic = {
  ownerA: "agent-interface-owner-a-synthetic",
  ownerB: "agent-interface-owner-b-synthetic",
  vaultA: "agent-interface-vault-a-synthetic",
  vaultB: "agent-interface-vault-b-synthetic",
  contactA: "agent-interface-contact-a-synthetic",
  contactB: "agent-interface-contact-b-synthetic",
  lateReminder: "agent-interface-late-reminder-synthetic",
};
const ownerIds = [synthetic.ownerA, synthetic.ownerB];
const allScopes: AgentScope[] = [
  "interactions:write",
  "proposals:write",
  "approvals:execute",
];

function requireDisposableDatabase(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is required");
  const databaseName = decodeURIComponent(
    new URL(raw).pathname.replace(/^\//, "")
  );
  if (!databaseName.endsWith("_test")) {
    throw new Error(
      "Agent interface integration tests require a database ending in _test"
    );
  }
}

requireDisposableDatabase();

interface Scenario {
  clientA: { client: { id: string }; token: string };
  clientA2: { client: { id: string }; token: string };
  clientB: { client: { id: string }; token: string };
  principalA: AgentPrincipal;
  principalA2: AgentPrincipal;
  principalB: AgentPrincipal;
}

describe("Agent interface PostgreSQL integrity", () => {
  const prisma = new PrismaService();
  const auth = new AgentAuthService(prisma);
  const audit = new AgentAuditService(prisma);
  const idempotency = new AgentIdempotencyService(prisma);
  const proposals = new ActionProposalService(prisma);
  const gamification = {
    calculateInteractionXp: async () => 10,
  } as unknown as GamificationService;
  const interactions = new InteractionsService(prisma, gamification);
  let scenario: Scenario;

  beforeAll(async () => {
    await prisma.$connect();
    await cleanup(prisma);
  });

  beforeEach(async () => {
    scenario = await seedScenario(prisma, auth);
  });

  afterEach(async () => {
    await cleanup(prisma);
  });

  afterAll(async () => {
    await cleanup(prisma);
    await prisma.$disconnect();
  });

  function registryFor(
    executors: ReadonlyMap<"message", ApprovedActionExecutor> = new Map()
  ): AgentToolRegistryService {
    const execution = new ApprovedActionExecutionService(prisma, executors);
    const handlers = new AgentToolHandlers(
      {} as AgentReadService,
      interactions,
      {} as AgentReminderCommands,
      {} as AgentFeedbackCommands,
      proposals,
      execution
    );
    return new AgentToolRegistryService(handlers, idempotency, audit);
  }

  it("commits one interaction and XP award across concurrent same-key calls, then conflicts on changed payload", async () => {
    const registry = registryFor();
    const request = {
      idempotencyKey: "agent:interaction:concurrent:001",
      contactId: synthetic.contactA,
      type: "call",
      title: "Synthetic concurrent interaction",
      content: "synthetic-audit-secret-body",
      occurredAt: "2026-07-16T12:00:00.000Z",
    };

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        registry.call("socos_log_interaction", scenario.principalA, request)
      )
    );
    const [storedInteractions, ledger, user, records, initialAudits] =
      await Promise.all([
        prisma.interaction.findMany({
          where: {
            ownerId: synthetic.ownerA,
            title: "Synthetic concurrent interaction",
          },
        }),
        prisma.xpTransaction.findMany({
          where: { ownerId: synthetic.ownerA, sourceType: "interaction" },
        }),
        prisma.user.findUniqueOrThrow({ where: { id: synthetic.ownerA } }),
        prisma.agentIdempotencyRecord.findMany({
          where: {
            clientId: scenario.principalA.clientId,
            operation: "socos_log_interaction",
            idempotencyKey: request.idempotencyKey,
          },
        }),
        prisma.mutationAuditEvent.findMany({
          where: {
            clientId: scenario.principalA.clientId,
            operation: "socos_log_interaction",
          },
        }),
      ]);

    const successful = results.find((result) => result.ok);
    const successfulCount = results.filter((result) => result.ok).length;
    expect(successful).toEqual(
      expect.objectContaining({
        ok: true,
        data: expect.objectContaining({ xpEarned: 10 }),
      })
    );
    for (const result of results) {
      if (result.ok) {
        expect(result).toEqual(successful);
      } else {
        expect(result).toEqual({
          ok: false,
          error: {
            code: "IDEMPOTENCY_CONFLICT",
            message: "Idempotent operation is still in progress.",
            retryable: true,
          },
        });
      }
    }
    expect(storedInteractions).toHaveLength(1);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].amount).toBe(10);
    expect(user.xp).toBe(17);
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe("completed");
    expect(initialAudits).toHaveLength(results.length);
    const initialSuccessAudits = initialAudits.filter(
      (event) => event.outcome === "succeeded"
    );
    expect(initialSuccessAudits).toHaveLength(successfulCount);
    expect(
      initialSuccessAudits.filter(
        (event) =>
          (event.metadata as { replayed?: boolean }).replayed === false
      )
    ).toHaveLength(1);
    expect(
      initialSuccessAudits.filter(
        (event) =>
          (event.metadata as { replayed?: boolean }).replayed === true
      )
    ).toHaveLength(successfulCount - 1);
    expect(
      initialAudits.filter((event) => event.outcome === "failed")
    ).toHaveLength(results.filter((result) => !result.ok).length);
    expect(JSON.stringify(initialAudits)).not.toContain(request.content);
    await expect(
      registry.call("socos_log_interaction", scenario.principalA, request)
    ).resolves.toEqual(successful);

    await expect(
      registry.call("socos_log_interaction", scenario.principalA, {
        ...request,
        title: "Changed synthetic payload",
      })
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "IDEMPOTENCY_CONFLICT",
        message: "Idempotency key conflicts with an existing request.",
        retryable: false,
      },
    });
    const finalAudits = await prisma.mutationAuditEvent.findMany({
      where: {
        clientId: scenario.principalA.clientId,
        operation: "socos_log_interaction",
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    expect(finalAudits).toHaveLength(results.length + 2);
    expect(
      finalAudits.filter(
        (event) =>
          event.outcome === "succeeded" &&
          (event.metadata as { replayed?: boolean }).replayed === true
      )
    ).toHaveLength(successfulCount);
    expect(
      finalAudits.filter(
        (event) =>
          event.outcome === "failed" &&
          (event.metadata as { errorCode?: string }).errorCode ===
            "IDEMPOTENCY_CONFLICT"
      )
    ).toHaveLength(results.filter((result) => !result.ok).length + 1);
    expect(
      finalAudits.every((event) =>
        /^[a-f0-9]{64}$/.test(event.requestHash ?? "")
      )
    ).toBe(true);
    expect(JSON.stringify(finalAudits)).not.toContain(request.content);
    expect(JSON.stringify(finalAudits)).not.toContain(
      "Changed synthetic payload"
    );
    await expect(
      prisma.interaction.count({
        where: { ownerId: synthetic.ownerA },
      })
    ).resolves.toBe(1);
    await expect(
      prisma.xpTransaction.count({
        where: { ownerId: synthetic.ownerA, sourceType: "interaction" },
      })
    ).resolves.toBe(1);
  });

  it("isolates owner resources and idempotency keys by authenticated client", async () => {
    const registry = registryFor();
    const sharedKey = "agent:client-isolation:001";

    await expect(
      registry.call("socos_log_interaction", scenario.principalA2, {
        idempotencyKey: sharedKey,
        contactId: synthetic.contactA,
        type: "message",
        title: "Synthetic client A2 interaction",
      })
    ).resolves.toEqual(expect.objectContaining({ ok: true }));
    await expect(
      registry.call("socos_log_interaction", scenario.principalB, {
        idempotencyKey: sharedKey,
        contactId: synthetic.contactB,
        type: "message",
        title: "Synthetic client B interaction",
      })
    ).resolves.toEqual(expect.objectContaining({ ok: true }));
    await expect(
      registry.call("socos_log_interaction", scenario.principalB, {
        idempotencyKey: "agent:foreign-contact:001",
        contactId: synthetic.contactA,
        type: "message",
        title: "Synthetic forbidden interaction",
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "NOT_FOUND" }),
      })
    );

    const [records, foreignWrites] = await Promise.all([
      prisma.agentIdempotencyRecord.findMany({
        where: { idempotencyKey: sharedKey },
        select: { ownerId: true, clientId: true },
      }),
      prisma.interaction.count({
        where: {
          ownerId: synthetic.ownerB,
          contactId: synthetic.contactA,
        },
      }),
    ]);
    expect(records).toHaveLength(2);
    expect(new Set(records.map((record) => record.clientId))).toEqual(
      new Set([scenario.principalA2.clientId, scenario.principalB.clientId])
    );
    expect(foreignWrites).toBe(0);
  });

  it("rotates and revokes credentials without exposing another owner's client", async () => {
    await expect(auth.authenticate(scenario.clientA.token)).resolves.toEqual(
      expect.objectContaining({ clientId: scenario.clientA.client.id })
    );
    await expect(
      auth.rotateClient(synthetic.ownerB, scenario.clientA.client.id)
    ).rejects.toBeInstanceOf(NotFoundException);

    const rotations = await Promise.allSettled([
      auth.rotateClient(synthetic.ownerA, scenario.clientA.client.id),
      auth.rotateClient(synthetic.ownerA, scenario.clientA.client.id),
    ]);
    const rotationTokens = rotations.flatMap((result) =>
      result.status === "fulfilled" ? [result.value.token] : []
    );
    expect(rotationTokens.length).toBeGreaterThanOrEqual(1);
    for (const result of rotations) {
      if (result.status === "rejected") {
        expect(["P2002", "P2034"]).toContain(
          (result.reason as { code?: string }).code
        );
      }
    }

    const activeCredentials = await prisma.agentCredential.findMany({
      where: {
        clientId: scenario.clientA.client.id,
        revokedAt: null,
      },
      select: { id: true },
    });
    expect(activeCredentials).toHaveLength(1);

    const candidateTokens = [scenario.clientA.token, ...rotationTokens];
    const tokenClaims = await Promise.allSettled(
      candidateTokens.map((token) => auth.authenticate(token))
    );
    const acceptedClaims = tokenClaims.filter(
      (result): result is PromiseFulfilledResult<AgentPrincipal> =>
        result.status === "fulfilled"
    );
    expect(acceptedClaims).toHaveLength(1);
    expect(acceptedClaims[0].value).toEqual(
      expect.objectContaining({
        ownerId: synthetic.ownerA,
        clientId: scenario.clientA.client.id,
        credentialId: activeCredentials[0].id,
      })
    );
    const activeToken =
      candidateTokens[
        tokenClaims.findIndex((result) => result.status === "fulfilled")
      ];
    for (const result of tokenClaims) {
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(UnauthorizedException);
      }
    }

    await auth.revokeClient(synthetic.ownerA, scenario.clientA.client.id);
    await expect(auth.authenticate(activeToken)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    const [client, unrevokedAfterRevoke] = await Promise.all([
      prisma.agentClient.findUniqueOrThrow({
        where: { id: scenario.clientA.client.id },
      }),
      prisma.agentCredential.count({
        where: {
          clientId: scenario.clientA.client.id,
          revokedAt: null,
        },
      }),
    ]);
    expect(client.status).toBe("revoked");
    expect(client.revokedAt).not.toBeNull();
    expect(unrevokedAfterRevoke).toBe(0);
  });

  it("binds approval to exact payload and client, preserves unavailable grants, and prevents replay", async () => {
    const input = messageProposalInput("agent:proposal:binding:001");
    const proposal = await proposals.createProposal(scenario.principalA, input);
    const grant = await proposals.approve(synthetic.ownerA, proposal.id);
    const executionInput = {
      grantId: grant.id,
      actionType: input.actionType,
      idempotencyKey: "agent:execute:binding:001",
      payload: input.payload,
    };
    const prepared: string[] = [];
    const executor: ApprovedActionExecutor = {
      prepare: async (context) => {
        prepared.push(context.proposalId);
      },
    };
    const available = new ApprovedActionExecutionService(
      prisma,
      new Map([["message", executor]])
    );

    await expect(
      available.execute(scenario.principalA2, executionInput)
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "APPROVAL_INVALID" }),
      })
    );
    await expect(
      available.execute(scenario.principalA, {
        ...executionInput,
        payload: { ...executionInput.payload, body: "Changed after approval" },
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "APPROVAL_INVALID" }),
      })
    );

    const unavailable = new ApprovedActionExecutionService(prisma);
    await expect(
      unavailable.execute(scenario.principalA, executionInput)
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: "ACTION_EXECUTION_UNAVAILABLE",
        }),
      })
    );
    await expect(
      prisma.approvalGrant.findUniqueOrThrow({ where: { id: grant.id } })
    ).resolves.toEqual(
      expect.objectContaining({ status: "active", consumedAt: null })
    );

    const executions = await Promise.allSettled([
      available.execute(scenario.principalA, executionInput),
      available.execute(scenario.principalA, {
        ...executionInput,
        idempotencyKey: "agent:execute:binding:concurrent:002",
      }),
    ]);
    const queued = executions.filter(
      (result) => result.status === "fulfilled" && result.value.ok
    );
    expect(queued).toHaveLength(1);
    for (const result of executions) {
      if (result.status === "rejected") {
        expect((result.reason as { code?: string }).code).toBe("P2034");
      } else if (result.value.ok === false) {
        expect(result.value.error.code).toBe("APPROVAL_INVALID");
      }
    }
    expect(prepared).toEqual([proposal.id]);
    const [storedGrant, outboxCount] = await Promise.all([
      prisma.approvalGrant.findUniqueOrThrow({ where: { id: grant.id } }),
      prisma.actionOutbox.count({ where: { grantId: grant.id } }),
    ]);
    expect(storedGrant).toEqual(
      expect.objectContaining({
        status: "consumed",
        consumedAt: expect.any(Date),
      })
    );
    expect(outboxCount).toBe(1);
    await expect(
      available.execute(scenario.principalA, {
        ...executionInput,
        idempotencyKey: "agent:execute:binding:replay:002",
      })
    ).resolves.toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "APPROVAL_INVALID" }),
      })
    );
  });

  it("rolls back grant consumption and executor writes after a late handler failure", async () => {
    const input = messageProposalInput("agent:proposal:rollback:001");
    const proposal = await proposals.createProposal(scenario.principalA, input);
    const grant = await proposals.approve(synthetic.ownerA, proposal.id);
    const executor: ApprovedActionExecutor = {
      prepare: async (_context, tx) => {
        await tx.reminder.create({
          data: {
            id: synthetic.lateReminder,
            ownerId: synthetic.ownerA,
            contactId: synthetic.contactA,
            type: "custom",
            title: "Synthetic rollback evidence",
            scheduledAt: new Date("2026-07-17T12:00:00.000Z"),
          },
        });
        throw new Error("Synthetic late approved handler failure");
      },
    };
    const execution = new ApprovedActionExecutionService(
      prisma,
      new Map([["message", executor]])
    );

    await expect(
      execution.execute(scenario.principalA, {
        grantId: grant.id,
        actionType: input.actionType,
        idempotencyKey: "agent:execute:rollback:001",
        payload: input.payload,
      })
    ).rejects.toThrow("Synthetic late approved handler failure");
    const [storedGrant, reminderCount, outboxCount] = await Promise.all([
      prisma.approvalGrant.findUniqueOrThrow({ where: { id: grant.id } }),
      prisma.reminder.count({ where: { id: synthetic.lateReminder } }),
      prisma.actionOutbox.count({ where: { grantId: grant.id } }),
    ]);
    expect(storedGrant).toEqual(
      expect.objectContaining({ status: "active", consumedAt: null })
    );
    expect(reminderCount).toBe(0);
    expect(outboxCount).toBe(0);
  });

  it("persists only allowlisted audit metadata and rejects secret-bearing metadata", async () => {
    await audit.record(scenario.principalA, {
      operation: "socos_synthetic_audit",
      outcome: "succeeded",
      requestHash: "a".repeat(64),
      idempotencyKey: "agent:audit:safe:001",
      metadata: {
        riskLevel: "automatic",
        replayed: false,
        attempt: 1,
      },
    });
    await expect(
      audit.record(scenario.principalA, {
        operation: "socos_synthetic_audit",
        outcome: "failed",
        metadata: {
          token: "socos_agent_synthetic_secret_never_persist",
        } as never,
      })
    ).rejects.toThrow("Unsafe agent audit metadata");

    const events = await prisma.mutationAuditEvent.findMany({
      where: {
        clientId: scenario.principalA.clientId,
        operation: "socos_synthetic_audit",
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toEqual({
      riskLevel: "automatic",
      replayed: false,
      attempt: 1,
    });
    expect(JSON.stringify(events)).not.toContain("synthetic_secret");
  });
});

function messageProposalInput(idempotencyKey: string) {
  return {
    actionType: "message" as const,
    idempotencyKey,
    payload: {
      contactId: synthetic.contactA,
      channel: "social" as const,
      body: "Synthetic approved message body",
    },
  };
}

async function seedScenario(
  prisma: PrismaService,
  auth: AgentAuthService
): Promise<Scenario> {
  await cleanup(prisma);
  await prisma.user.createMany({
    data: [
      {
        id: synthetic.ownerA,
        email: "agent-interface-owner-a@example.invalid",
        name: "Synthetic Agent Owner A",
        xp: 7,
      },
      {
        id: synthetic.ownerB,
        email: "agent-interface-owner-b@example.invalid",
        name: "Synthetic Agent Owner B",
        xp: 7,
      },
    ],
  });
  await prisma.vault.createMany({
    data: [
      {
        id: synthetic.vaultA,
        ownerId: synthetic.ownerA,
        name: "Synthetic Agent Vault A",
      },
      {
        id: synthetic.vaultB,
        ownerId: synthetic.ownerB,
        name: "Synthetic Agent Vault B",
      },
    ],
  });
  await prisma.contact.createMany({
    data: [
      {
        id: synthetic.contactA,
        vaultId: synthetic.vaultA,
        ownerId: synthetic.ownerA,
        firstName: "Synthetic Agent A",
        isDemo: false,
      },
      {
        id: synthetic.contactB,
        vaultId: synthetic.vaultB,
        ownerId: synthetic.ownerB,
        firstName: "Synthetic Agent B",
        isDemo: false,
      },
    ],
  });
  const achievement = await prisma.achievement.upsert({
    where: { code: "first_interaction" },
    update: {},
    create: {
      code: "first_interaction",
      name: "First Interaction",
      description: "Synthetic integration prerequisite",
      xpReward: 50,
      requirement: JSON.stringify({
        type: "count",
        target: 1,
        object: "interactions",
      }),
    },
  });
  await prisma.userAchievement.createMany({
    data: ownerIds.map((userId) => ({
      userId,
      achievementId: achievement.id,
    })),
    skipDuplicates: true,
  });

  const [clientA, clientA2, clientB] = await Promise.all([
    auth.createClient(synthetic.ownerA, {
      name: "Synthetic Agent Client A",
      scopes: allScopes,
    }),
    auth.createClient(synthetic.ownerA, {
      name: "Synthetic Agent Client A2",
      scopes: allScopes,
    }),
    auth.createClient(synthetic.ownerB, {
      name: "Synthetic Agent Client B",
      scopes: allScopes,
    }),
  ]);
  const [principalA, principalA2, principalB] = await Promise.all([
    auth.authenticate(clientA.token),
    auth.authenticate(clientA2.token),
    auth.authenticate(clientB.token),
  ]);
  return {
    clientA,
    clientA2,
    clientB,
    principalA,
    principalA2,
    principalB,
  };
}

async function cleanup(prisma: PrismaService): Promise<void> {
  // The audit table's append-only row trigger intentionally rejects DELETE.
  await prisma.$executeRaw`TRUNCATE TABLE "MutationAuditEvent"`;
  await prisma.user.deleteMany({ where: { id: { in: ownerIds } } });
}
