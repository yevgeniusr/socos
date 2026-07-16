BEGIN;

CREATE TABLE "AgentClient" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'active',
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgentClient_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentClient_status_check" CHECK ("status" IN ('active', 'revoked'))
);

CREATE TABLE "AgentCredential" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentCredential_tokenHash_check" CHECK (char_length("tokenHash") = 64)
);

CREATE TABLE "AgentIdempotencyRecord" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'in_progress',
  "response" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AgentIdempotencyRecord_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentIdempotencyRecord_status_check" CHECK ("status" IN ('in_progress', 'completed', 'failed')),
  CONSTRAINT "AgentIdempotencyRecord_requestHash_check" CHECK (char_length("requestHash") = 64)
);

CREATE TABLE "ActionProposal" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "riskLevel" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "preview" JSONB NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ActionProposal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActionProposal_status_check" CHECK ("status" IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  CONSTRAINT "ActionProposal_riskLevel_check" CHECK ("riskLevel" = 'approval_required'),
  CONSTRAINT "ActionProposal_actionType_check" CHECK ("actionType" IN ('message', 'introduction', 'invitation', 'merge', 'delete')),
  CONSTRAINT "ActionProposal_payloadHash_check" CHECK (char_length("payloadHash") = 64)
);

CREATE TABLE "ApprovalGrant" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "proposalId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ApprovalGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApprovalGrant_status_check" CHECK ("status" IN ('active', 'consumed', 'revoked', 'expired'))
);

CREATE TABLE "MutationAuditEvent" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "actionType" TEXT,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "outcome" TEXT NOT NULL,
  "requestHash" TEXT,
  "idempotencyKey" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MutationAuditEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MutationAuditEvent_outcome_check" CHECK ("outcome" IN ('succeeded', 'rejected', 'failed')),
  CONSTRAINT "MutationAuditEvent_requestHash_check" CHECK ("requestHash" IS NULL OR char_length("requestHash") = 64)
);

CREATE TABLE "ActionOutbox" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "grantId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ActionOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActionOutbox_status_check" CHECK ("status" IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  CONSTRAINT "ActionOutbox_attempts_check" CHECK ("attempts" >= 0)
);

CREATE UNIQUE INDEX "AgentClient_id_ownerId_key" ON "AgentClient"("id", "ownerId");
CREATE INDEX "AgentClient_ownerId_status_idx" ON "AgentClient"("ownerId", "status");

CREATE UNIQUE INDEX "AgentCredential_tokenPrefix_key" ON "AgentCredential"("tokenPrefix");
CREATE UNIQUE INDEX "AgentCredential_one_unrevoked_per_client_key" ON "AgentCredential"("clientId") WHERE "revokedAt" IS NULL;
CREATE INDEX "AgentCredential_ownerId_clientId_idx" ON "AgentCredential"("ownerId", "clientId");
CREATE INDEX "AgentCredential_expiresAt_idx" ON "AgentCredential"("expiresAt");

CREATE UNIQUE INDEX "AgentIdempotencyRecord_clientId_operation_idempotencyKey_key" ON "AgentIdempotencyRecord"("clientId", "operation", "idempotencyKey");
CREATE INDEX "AgentIdempotencyRecord_ownerId_clientId_idx" ON "AgentIdempotencyRecord"("ownerId", "clientId");
CREATE INDEX "AgentIdempotencyRecord_expiresAt_idx" ON "AgentIdempotencyRecord"("expiresAt");

CREATE UNIQUE INDEX "ActionProposal_id_ownerId_clientId_key" ON "ActionProposal"("id", "ownerId", "clientId");
CREATE INDEX "ActionProposal_ownerId_status_idx" ON "ActionProposal"("ownerId", "status");
CREATE INDEX "ActionProposal_expiresAt_idx" ON "ActionProposal"("expiresAt");

CREATE UNIQUE INDEX "ApprovalGrant_proposalId_key" ON "ApprovalGrant"("proposalId");
CREATE UNIQUE INDEX "ApprovalGrant_id_ownerId_clientId_key" ON "ApprovalGrant"("id", "ownerId", "clientId");
CREATE UNIQUE INDEX "ApprovalGrant_proposalId_ownerId_clientId_key" ON "ApprovalGrant"("proposalId", "ownerId", "clientId");
CREATE INDEX "ApprovalGrant_ownerId_status_idx" ON "ApprovalGrant"("ownerId", "status");
CREATE INDEX "ApprovalGrant_expiresAt_idx" ON "ApprovalGrant"("expiresAt");

CREATE INDEX "MutationAuditEvent_ownerId_createdAt_idx" ON "MutationAuditEvent"("ownerId", "createdAt");
CREATE INDEX "MutationAuditEvent_clientId_createdAt_idx" ON "MutationAuditEvent"("clientId", "createdAt");

CREATE UNIQUE INDEX "ActionOutbox_grantId_key" ON "ActionOutbox"("grantId");
CREATE UNIQUE INDEX "ActionOutbox_grantId_ownerId_clientId_key" ON "ActionOutbox"("grantId", "ownerId", "clientId");
CREATE INDEX "ActionOutbox_ownerId_status_idx" ON "ActionOutbox"("ownerId", "status");
CREATE INDEX "ActionOutbox_status_availableAt_idx" ON "ActionOutbox"("status", "availableAt");

ALTER TABLE "AgentClient"
  ADD CONSTRAINT "AgentClient_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentCredential"
  ADD CONSTRAINT "AgentCredential_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AgentCredential_clientId_ownerId_fkey" FOREIGN KEY ("clientId", "ownerId") REFERENCES "AgentClient"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AgentIdempotencyRecord"
  ADD CONSTRAINT "AgentIdempotencyRecord_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "AgentIdempotencyRecord_clientId_ownerId_fkey" FOREIGN KEY ("clientId", "ownerId") REFERENCES "AgentClient"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ActionProposal"
  ADD CONSTRAINT "ActionProposal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ActionProposal_clientId_ownerId_fkey" FOREIGN KEY ("clientId", "ownerId") REFERENCES "AgentClient"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApprovalGrant"
  ADD CONSTRAINT "ApprovalGrant_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ApprovalGrant_clientId_ownerId_fkey" FOREIGN KEY ("clientId", "ownerId") REFERENCES "AgentClient"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ApprovalGrant_proposalId_ownerId_clientId_fkey" FOREIGN KEY ("proposalId", "ownerId", "clientId") REFERENCES "ActionProposal"("id", "ownerId", "clientId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MutationAuditEvent"
  ADD CONSTRAINT "MutationAuditEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "MutationAuditEvent_clientId_ownerId_fkey" FOREIGN KEY ("clientId", "ownerId") REFERENCES "AgentClient"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ActionOutbox"
  ADD CONSTRAINT "ActionOutbox_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ActionOutbox_clientId_ownerId_fkey" FOREIGN KEY ("clientId", "ownerId") REFERENCES "AgentClient"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ActionOutbox_grantId_ownerId_clientId_fkey" FOREIGN KEY ("grantId", "ownerId", "clientId") REFERENCES "ApprovalGrant"("id", "ownerId", "clientId") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "reject_mutation_audit_event_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'MutationAuditEvent is append-only';
END;
$$;

CREATE TRIGGER "MutationAuditEvent_append_only"
BEFORE UPDATE OR DELETE ON "MutationAuditEvent"
FOR EACH ROW EXECUTE FUNCTION "reject_mutation_audit_event_change"();

COMMIT;
