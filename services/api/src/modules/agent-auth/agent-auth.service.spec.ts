import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service.js";
import { AgentAuthService } from "./agent-auth.service.js";
import { issueAgentToken, parseAgentToken } from "./agent-token.js";

const ownerId = "owner-synthetic";
const now = new Date("2026-07-16T12:00:00.000Z");

interface CredentialRow {
  id: string;
  tokenHash: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  client: {
    id: string;
    ownerId: string;
    name: string;
    status: string;
    scopes: string[];
    revokedAt: Date | null;
  };
}

const invalidCredentialCases: Array<{
  label: string;
  mutate: (row: CredentialRow) => CredentialRow;
}> = [
  { label: "wrong secret", mutate: (row) => row },
  {
    label: "revoked credential",
    mutate: (row) => ({ ...row, revokedAt: now }),
  },
  {
    label: "expired credential",
    mutate: (row) => ({
      ...row,
      expiresAt: new Date("2026-07-15T12:00:00.000Z"),
    }),
  },
  {
    label: "revoked client",
    mutate: (row) => ({
      ...row,
      client: { ...row.client, status: "revoked", revokedAt: now },
    }),
  },
];

function harness() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    agentClient: {
      create: jest.fn().mockResolvedValue({
        id: "client-synthetic",
        ownerId,
        name: "Hermes",
        status: "active",
        scopes: ["briefs:read"],
        createdAt: now,
      }),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    agentCredential: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: data.id,
          clientId: data.clientId,
          createdAt: now,
        })
      ),
      findFirst: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
    agentClient: { findMany: jest.fn() },
    agentCredential: {
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const service = new AgentAuthService(prisma as unknown as PrismaService);
  return { service, prisma, tx };
}

describe("AgentAuthService", () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(now));
  afterEach(() => jest.useRealTimers());

  it("creates a client and reveals its credential token exactly once", async () => {
    const { service, tx } = harness();

    const result = await service.createClient(ownerId, {
      name: "Hermes",
      scopes: ["briefs:read"],
    });

    expect(result.token).toMatch(/^socos_agent_/);
    expect(result.client).toEqual(
      expect.objectContaining({
        id: "client-synthetic",
        ownerId,
        name: "Hermes",
      })
    );
    const credentialData = tx.agentCredential.create.mock.calls[0][0].data;
    expect(credentialData.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(credentialData.tokenPrefix).toBe(`socos_agent_${credentialData.id}`);
    expect(JSON.stringify(credentialData)).not.toContain(result.token);
  });

  it("lists owner clients without credential hashes or tokens", async () => {
    const { service, prisma } = harness();
    prisma.agentClient.findMany.mockResolvedValue([{ id: "client-synthetic" }]);

    await expect(service.listClients(ownerId)).resolves.toEqual([
      { id: "client-synthetic" },
    ]);
    expect(prisma.agentClient.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ownerId },
        select: expect.not.objectContaining({ token: true, tokenHash: true }),
      })
    );
  });

  it("authenticates an active credential and returns server-owned scopes", async () => {
    const { service, prisma } = harness();
    const issued = issueAgentToken("credentialSynthetic01");
    const parsed = parseAgentToken(issued.token)!;
    prisma.agentCredential.findUnique.mockResolvedValue({
      id: parsed.credentialId,
      tokenHash: issued.secretHash,
      revokedAt: null,
      expiresAt: new Date("2026-07-17T12:00:00.000Z"),
      client: {
        id: "client-synthetic",
        ownerId,
        name: "Hermes",
        status: "active",
        scopes: ["briefs:read", "feedback:write"],
        revokedAt: null,
      },
    });

    await expect(service.authenticate(issued.token)).resolves.toEqual({
      ownerId,
      clientId: "client-synthetic",
      clientName: "Hermes",
      credentialId: parsed.credentialId,
      scopes: ["briefs:read", "feedback:write"],
    });
    expect(prisma.agentCredential.updateMany).toHaveBeenCalledWith({
      where: {
        id: parsed.credentialId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        client: { status: "active", revokedAt: null },
      },
      data: { lastUsedAt: now },
    });
  });

  it.each(invalidCredentialCases)(
    "rejects $label",
    async ({ label, mutate }) => {
      const { service, prisma } = harness();
      const issued = issueAgentToken("credentialSynthetic01");
      const presented =
        label === "wrong secret"
          ? issueAgentToken("credentialSynthetic01").token
          : issued.token;
      prisma.agentCredential.findUnique.mockResolvedValue(
        mutate({
          id: "credentialSynthetic01",
          tokenHash: issued.secretHash,
          revokedAt: null,
          expiresAt: null,
          client: {
            id: "client-synthetic",
            ownerId,
            name: "Hermes",
            status: "active",
            scopes: ["briefs:read"],
            revokedAt: null,
          },
        })
      );

      await expect(service.authenticate(presented)).rejects.toBeInstanceOf(
        UnauthorizedException
      );
      expect(prisma.agentCredential.updateMany).not.toHaveBeenCalled();
    }
  );

  it("rejects a credential revoked after lookup but before its usage claim", async () => {
    const { service, prisma } = harness();
    const issued = issueAgentToken("credentialSynthetic01");
    const parsed = parseAgentToken(issued.token)!;
    prisma.agentCredential.findUnique.mockResolvedValue({
      id: parsed.credentialId,
      tokenHash: issued.secretHash,
      revokedAt: null,
      expiresAt: new Date("2026-07-17T12:00:00.000Z"),
      client: {
        id: "client-synthetic",
        ownerId,
        name: "Hermes",
        status: "active",
        scopes: ["briefs:read"],
        revokedAt: null,
      },
    });
    prisma.agentCredential.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.authenticate(issued.token)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it("rotates only an owner-scoped active client without extending credential expiry", async () => {
    const { prisma, service, tx } = harness();
    const expiresAt = new Date("2026-07-17T12:00:00.000Z");
    tx.agentClient.findFirst.mockResolvedValue({
      id: "client-synthetic",
      ownerId,
      status: "active",
    });
    tx.agentCredential.findFirst.mockResolvedValue({ expiresAt });

    const result = await service.rotateClient(ownerId, "client-synthetic");

    expect(result.token).toMatch(/^socos_agent_/);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0][1]).toBe(
      JSON.stringify([ownerId, "client-synthetic"])
    );
    expect(tx.$queryRaw.mock.calls[0][0].join("?")).toContain(
      'SELECT 1::integer AS "acquired"'
    );
    expect(tx.$queryRaw.mock.calls[0][0].join("?")).toContain(
      'AS "agent_credential_lifecycle_lock"'
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.agentClient.findFirst.mock.invocationCallOrder[0]
    );
    expect(tx.agentCredential.updateMany).toHaveBeenCalledWith({
      where: { clientId: "client-synthetic", ownerId, revokedAt: null },
      data: { revokedAt: now },
    });
    expect(tx.agentCredential.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ expiresAt }),
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it("does not issue a replacement unless it claims exactly one active credential", async () => {
    const { service, tx } = harness();
    tx.agentClient.findFirst.mockResolvedValue({
      id: "client-synthetic",
      ownerId,
      status: "active",
    });
    tx.agentCredential.findFirst.mockResolvedValue({
      id: "credential-current",
      expiresAt: null,
    });
    tx.agentCredential.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.rotateClient(ownerId, "client-synthetic")
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(tx.agentCredential.create).not.toHaveBeenCalled();
  });

  it("defines a database invariant allowing one unrevoked credential per client", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "prisma/migrations/20260716140000_agent_interface/migration.sql"
      ),
      "utf8"
    );

    expect(migration).toContain(
      'CREATE UNIQUE INDEX "AgentCredential_one_unrevoked_per_client_key" ON "AgentCredential"("clientId") WHERE "revokedAt" IS NULL'
    );
  });

  it("does not disclose whether another owner's client exists", async () => {
    const { service, tx } = harness();
    tx.agentClient.findFirst.mockResolvedValue(null);

    await expect(
      service.rotateClient(ownerId, "other-owner-client")
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("serializes revocation on the same owner/client credential lifecycle lock", async () => {
    const { prisma, service, tx } = harness();

    await service.revokeClient(ownerId, "client-synthetic");

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0][1]).toBe(
      JSON.stringify([ownerId, "client-synthetic"])
    );
    expect(tx.$queryRaw.mock.calls[0][0].join("?")).toContain(
      'SELECT 1::integer AS "acquired"'
    );
    expect(tx.$queryRaw.mock.calls[0][0].join("?")).toContain(
      'AS "agent_credential_lifecycle_lock"'
    );
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.agentClient.updateMany.mock.invocationCallOrder[0]
    );
    expect(tx.agentClient.updateMany).toHaveBeenCalledWith({
      where: { id: "client-synthetic", ownerId, revokedAt: null },
      data: { status: "revoked", revokedAt: now },
    });
    expect(tx.agentCredential.updateMany).toHaveBeenCalledWith({
      where: { clientId: "client-synthetic", ownerId, revokedAt: null },
      data: { revokedAt: now },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });
});
