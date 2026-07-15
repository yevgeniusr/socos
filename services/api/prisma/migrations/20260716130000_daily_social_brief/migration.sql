BEGIN;

ALTER TABLE "User"
  ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN "briefHourLocal" INTEGER NOT NULL DEFAULT 8,
  ADD CONSTRAINT "User_briefHourLocal_check" CHECK ("briefHourLocal" BETWEEN 0 AND 23);

ALTER TABLE "Contact"
  ADD COLUMN "importance" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "preferredCadenceDays" INTEGER NOT NULL DEFAULT 90,
  ADD CONSTRAINT "Contact_importance_check" CHECK ("importance" BETWEEN 1 AND 5),
  ADD CONSTRAINT "Contact_preferredCadenceDays_check" CHECK ("preferredCadenceDays" BETWEEN 7 AND 365);

CREATE TABLE "BriefBatch" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "localDate" DATE NOT NULL,
  "timeZone" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'generating',
  "generatedAt" TIMESTAMP(3),
  "schemaVersion" TEXT NOT NULL DEFAULT '1.0',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BriefBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BriefItem" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "contactId" TEXT,
  "kind" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "rank" INTEGER NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "title" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "snoozedUntil" TIMESTAMP(3),
  "actionedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BriefItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Quest" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "briefItemId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "completionType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "xpReward" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Quest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Quest_xpReward_check" CHECK ("xpReward" >= 0)
);

CREATE TABLE "BriefFeedback" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "briefItemId" TEXT,
  "questId" TEXT,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "snoozedUntil" TIMESTAMP(3),
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BriefFeedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BriefFeedback_target_check" CHECK (num_nonnulls("briefItemId", "questId") = 1)
);

CREATE TABLE "XpTransaction" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "XpTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BriefBatch_ownerId_localDate_key" ON "BriefBatch"("ownerId", "localDate");
CREATE UNIQUE INDEX "BriefBatch_id_ownerId_key" ON "BriefBatch"("id", "ownerId");
CREATE INDEX "BriefBatch_ownerId_status_idx" ON "BriefBatch"("ownerId", "status");

CREATE UNIQUE INDEX "BriefItem_batchId_kind_rank_key" ON "BriefItem"("batchId", "kind", "rank");
CREATE UNIQUE INDEX "BriefItem_id_ownerId_key" ON "BriefItem"("id", "ownerId");
CREATE UNIQUE INDEX "BriefItem_id_batchId_ownerId_key" ON "BriefItem"("id", "batchId", "ownerId");
CREATE INDEX "BriefItem_ownerId_contactId_idx" ON "BriefItem"("ownerId", "contactId");
CREATE INDEX "BriefItem_ownerId_status_snoozedUntil_idx" ON "BriefItem"("ownerId", "status", "snoozedUntil");

CREATE UNIQUE INDEX "Quest_batchId_briefItemId_key" ON "Quest"("batchId", "briefItemId");
CREATE UNIQUE INDEX "Quest_id_ownerId_key" ON "Quest"("id", "ownerId");
CREATE INDEX "Quest_ownerId_status_idx" ON "Quest"("ownerId", "status");

CREATE UNIQUE INDEX "BriefFeedback_ownerId_idempotencyKey_key" ON "BriefFeedback"("ownerId", "idempotencyKey");
CREATE INDEX "BriefFeedback_ownerId_briefItemId_createdAt_idx" ON "BriefFeedback"("ownerId", "briefItemId", "createdAt");

CREATE UNIQUE INDEX "XpTransaction_ownerId_sourceType_sourceId_key" ON "XpTransaction"("ownerId", "sourceType", "sourceId");
CREATE INDEX "XpTransaction_ownerId_createdAt_idx" ON "XpTransaction"("ownerId", "createdAt");

ALTER TABLE "BriefBatch"
  ADD CONSTRAINT "BriefBatch_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BriefItem"
  ADD CONSTRAINT "BriefItem_batchId_ownerId_fkey" FOREIGN KEY ("batchId", "ownerId") REFERENCES "BriefBatch"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "BriefItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Quest"
  ADD CONSTRAINT "Quest_batchId_ownerId_fkey" FOREIGN KEY ("batchId", "ownerId") REFERENCES "BriefBatch"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Quest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Quest_briefItemId_batchId_ownerId_fkey" FOREIGN KEY ("briefItemId", "batchId", "ownerId") REFERENCES "BriefItem"("id", "batchId", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BriefFeedback"
  ADD CONSTRAINT "BriefFeedback_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "BriefFeedback_briefItemId_ownerId_fkey" FOREIGN KEY ("briefItemId", "ownerId") REFERENCES "BriefItem"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "BriefFeedback_questId_ownerId_fkey" FOREIGN KEY ("questId", "ownerId") REFERENCES "Quest"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "XpTransaction"
  ADD CONSTRAINT "XpTransaction_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
