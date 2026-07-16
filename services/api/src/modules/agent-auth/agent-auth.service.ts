import { randomUUID } from "node:crypto";
import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AgentPrincipal, AgentScope } from "@socos/agent-core";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  issueAgentToken,
  parseAgentToken,
  verifyAgentTokenSecret,
} from "./agent-token.js";

export interface CreateAgentClientInput {
  name: string;
  scopes: AgentScope[];
  expiresAt?: Date | null;
}

const clientPresenter = {
  id: true,
  ownerId: true,
  name: true,
  status: true,
  scopes: true,
  createdAt: true,
  updatedAt: true,
  revokedAt: true,
};

@Injectable()
export class AgentAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async createClient(ownerId: string, input: CreateAgentClientInput) {
    const credentialId = randomUUID();
    const issued = issueAgentToken(credentialId);
    const client = await this.prisma.$transaction(async (tx) => {
      const created = await tx.agentClient.create({
        data: {
          ownerId,
          name: input.name,
          scopes: input.scopes,
          status: "active",
        },
        select: clientPresenter,
      });
      await tx.agentCredential.create({
        data: {
          id: credentialId,
          clientId: created.id,
          ownerId,
          tokenPrefix: `socos_agent_${credentialId}`,
          tokenHash: issued.secretHash,
          expiresAt: input.expiresAt ?? null,
        },
      });
      return created;
    });

    return { client, token: issued.token };
  }

  listClients(ownerId: string) {
    return this.prisma.agentClient.findMany({
      where: { ownerId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        ...clientPresenter,
        credentials: {
          orderBy: [{ createdAt: "desc" as const }, { id: "asc" as const }],
          select: {
            id: true,
            createdAt: true,
            expiresAt: true,
            lastUsedAt: true,
            revokedAt: true,
          },
        },
      },
    });
  }

  async rotateClient(ownerId: string, clientId: string) {
    const credentialId = randomUUID();
    const issued = issueAgentToken(credentialId);
    const client = await this.prisma.$transaction(
      async (tx) => {
        await acquireCredentialLifecycleLock(tx, ownerId, clientId);

        const current = await tx.agentClient.findFirst({
          where: { id: clientId, ownerId, status: "active", revokedAt: null },
          select: clientPresenter,
        });
        if (!current) throw new NotFoundException("Agent client not found");
        const activeCredential = await tx.agentCredential.findFirst({
          where: { clientId, ownerId, revokedAt: null },
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          select: { expiresAt: true },
        });
        if (!activeCredential) {
          throw new NotFoundException("Agent client not found");
        }

        const now = new Date();
        const claim = await tx.agentCredential.updateMany({
          where: { clientId, ownerId, revokedAt: null },
          data: { revokedAt: now },
        });
        if (claim.count !== 1) {
          throw new NotFoundException("Agent client not found");
        }
        await tx.agentCredential.create({
          data: {
            id: credentialId,
            clientId,
            ownerId,
            tokenPrefix: `socos_agent_${credentialId}`,
            tokenHash: issued.secretHash,
            expiresAt: activeCredential.expiresAt,
          },
        });
        return current;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    return { client, token: issued.token };
  }

  async revokeClient(ownerId: string, clientId: string): Promise<void> {
    const revoked = await this.prisma.$transaction(
      async (tx) => {
        await acquireCredentialLifecycleLock(tx, ownerId, clientId);
        const now = new Date();
        const result = await tx.agentClient.updateMany({
          where: { id: clientId, ownerId, revokedAt: null },
          data: { status: "revoked", revokedAt: now },
        });
        if (result.count === 0) return false;
        await tx.agentCredential.updateMany({
          where: { clientId, ownerId, revokedAt: null },
          data: { revokedAt: now },
        });
        return true;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    if (!revoked) throw new NotFoundException("Agent client not found");
  }

  async authenticate(token: string): Promise<AgentPrincipal> {
    const parsed = parseAgentToken(token);
    if (!parsed) throw invalidCredential();

    const credential = await this.prisma.agentCredential.findUnique({
      where: { id: parsed.credentialId },
      select: {
        id: true,
        tokenHash: true,
        revokedAt: true,
        expiresAt: true,
        client: {
          select: {
            id: true,
            ownerId: true,
            name: true,
            status: true,
            scopes: true,
            revokedAt: true,
          },
        },
      },
    });
    const now = new Date();
    if (
      !credential ||
      credential.revokedAt ||
      (credential.expiresAt && credential.expiresAt <= now) ||
      credential.client.status !== "active" ||
      credential.client.revokedAt ||
      !verifyAgentTokenSecret(parsed.secret, credential.tokenHash)
    ) {
      throw invalidCredential();
    }

    const claimed = await this.prisma.agentCredential.updateMany({
      where: {
        id: credential.id,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        client: { status: "active", revokedAt: null },
      },
      data: { lastUsedAt: now },
    });
    if (claimed.count !== 1) throw invalidCredential();
    return {
      ownerId: credential.client.ownerId,
      clientId: credential.client.id,
      clientName: credential.client.name,
      credentialId: credential.id,
      scopes: credential.client.scopes as AgentScope[],
    };
  }
}

async function acquireCredentialLifecycleLock(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  clientId: string
): Promise<void> {
  const lockKey = JSON.stringify([ownerId, clientId]);
  await transaction.$queryRaw`
    SELECT 1::integer AS "acquired"
    FROM (
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    ) AS "agent_credential_lifecycle_lock"
  `;
}

function invalidCredential(): UnauthorizedException {
  return new UnauthorizedException("Invalid or expired agent credential");
}
