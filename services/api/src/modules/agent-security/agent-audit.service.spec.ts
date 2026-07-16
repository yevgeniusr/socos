import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentPrincipal } from "@socos/agent-core";
import type { PrismaService } from "../prisma/prisma.service.js";
import { AgentAuditService } from "./agent-audit.service.js";

const principal: AgentPrincipal = {
  ownerId: "owner-synthetic",
  clientId: "client-synthetic",
  credentialId: "credential-synthetic",
  clientName: "Hermes Synthetic",
  scopes: ["interactions:write"],
};

function harness() {
  const created = {
    id: "audit-synthetic",
    createdAt: new Date("2026-07-16T12:00:00.000Z"),
  };
  const prisma = {
    mutationAuditEvent: {
      create: jest.fn().mockResolvedValue(created),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  return {
    service: new AgentAuditService(prisma as unknown as PrismaService),
    prisma,
    created,
  };
}

describe("AgentAuditService", () => {
  it("creates a sanitized event using server-owned principal identity", async () => {
    const { service, prisma, created } = harness();

    await expect(
      service.record(principal, {
        operation: "interactions.create",
        actionType: "message",
        resourceType: "interaction",
        resourceId: "interaction-synthetic",
        outcome: "succeeded",
        requestHash: "a".repeat(64),
        idempotencyKey: "interaction:intent-001",
        metadata: {
          riskLevel: "automatic",
          replayed: false,
          attempt: 1,
        },
      })
    ).resolves.toEqual(created);

    expect(prisma.mutationAuditEvent.create).toHaveBeenCalledWith({
      data: {
        ownerId: principal.ownerId,
        clientId: principal.clientId,
        operation: "interactions.create",
        actionType: "message",
        resourceType: "interaction",
        resourceId: "interaction-synthetic",
        outcome: "succeeded",
        requestHash: "a".repeat(64),
        idempotencyKey: "interaction:intent-001",
        metadata: {
          riskLevel: "automatic",
          replayed: false,
          attempt: 1,
        },
      },
      select: { id: true, createdAt: true },
    });
    expect(prisma.mutationAuditEvent.update).not.toHaveBeenCalled();
    expect(prisma.mutationAuditEvent.delete).not.toHaveBeenCalled();
  });

  it.each([
    ["payload", { body: "private message" }],
    ["token", "socos_agent_secret"],
    ["email", "person@example.invalid"],
    ["phone", "+971500000000"],
    ["providerResponse", { raw: true }],
    ["contactName", "Private Person"],
  ])("rejects unsafe audit metadata key %s", async (key, value) => {
    const { service, prisma } = harness();

    await expect(
      service.record(principal, {
        operation: "interactions.create",
        outcome: "failed",
        metadata: { [key]: value },
      })
    ).rejects.toThrow("Unsafe agent audit metadata");
    expect(prisma.mutationAuditEvent.create).not.toHaveBeenCalled();
  });

  it("can append through an existing transaction without exposing mutation methods", async () => {
    const { service, prisma, created } = harness();
    const tx = {
      mutationAuditEvent: {
        create: jest.fn().mockResolvedValue(created),
      },
    };

    await service.record(
      principal,
      {
        operation: "interactions.create",
        outcome: "rejected",
        metadata: { errorCode: "APPROVAL_REQUIRED" },
      },
      tx as never
    );

    expect(tx.mutationAuditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.mutationAuditEvent.create).not.toHaveBeenCalled();
    expect("update" in service).toBe(false);
    expect("delete" in service).toBe(false);
  });

  it("is protected by an append-only database trigger", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "prisma/migrations/20260716140000_agent_interface/migration.sql"
      ),
      "utf8"
    );

    expect(migration).toContain(
      'CREATE TRIGGER "MutationAuditEvent_append_only"'
    );
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
    expect(migration).toContain("MutationAuditEvent is append-only");
  });
});
