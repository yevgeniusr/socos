-- Reconcile databases originally managed by `prisma db push` with the checked-in
-- Prisma model. The legacy branch preserves row identity and maps old columns to
-- their current equivalents. On an already-current production database it is a
-- no-op apart from idempotently ensuring additions that may be absent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Contact' AND column_name = 'name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Contact' AND column_name = 'firstName'
  ) THEN
    -- Remove constraints whose ownership or delete behavior changed.
    ALTER TABLE "Activity" DROP CONSTRAINT IF EXISTS "Activity_contactId_fkey";
    ALTER TABLE "Activity" DROP CONSTRAINT IF EXISTS "Activity_userId_fkey";
    ALTER TABLE "Gift" DROP CONSTRAINT IF EXISTS "Gift_userId_fkey";
    ALTER TABLE "Interaction" DROP CONSTRAINT IF EXISTS "Interaction_userId_fkey";
    ALTER TABLE "Reminder" DROP CONSTRAINT IF EXISTS "Reminder_userId_fkey";
    ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_contactId_fkey";
    ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_userId_fkey";
    ALTER TABLE "VaultMember" DROP CONSTRAINT IF EXISTS "VaultMember_userId_fkey";

    -- Preserve meaningful legacy values by renaming equivalent columns first.
    ALTER TABLE "Contact" RENAME COLUMN "name" TO "firstName";
    ALTER TABLE "Contact" RENAME COLUMN "avatar" TO "photo";
    ALTER TABLE "Contact" RENAME COLUMN "notes" TO "bio";
    ALTER TABLE "Contact" RENAME COLUMN "lastInteractionAt" TO "lastContactedAt";
    ALTER TABLE "Contact"
      DROP COLUMN "level",
      DROP COLUMN "timezone",
      DROP COLUMN "xp",
      ADD COLUMN "anniversary" TIMESTAMP(3),
      ADD COLUMN "company" TEXT,
      ADD COLUMN "firstMetContext" TEXT,
      ADD COLUMN "firstMetDate" TIMESTAMP(3),
      ADD COLUMN "jobTitle" TEXT,
      ADD COLUMN "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
      ADD COLUMN "lastName" TEXT,
      ADD COLUMN "middleName" TEXT,
      ADD COLUMN "nextReminderAt" TIMESTAMP(3),
      ADD COLUMN "nickname" TEXT,
      ADD COLUMN "relationshipScore" INTEGER NOT NULL DEFAULT 50,
      ADD COLUMN "socialLinks" JSONB;
    ALTER TABLE "Contact" ALTER COLUMN "tags" SET DEFAULT ARRAY[]::TEXT[];

    ALTER TABLE "ContactField" RENAME COLUMN "isPublic" TO "isPrimary";
    ALTER TABLE "ContactField" ADD COLUMN "updatedAt" TIMESTAMP(3);
    UPDATE "ContactField" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
    ALTER TABLE "ContactField" ALTER COLUMN "updatedAt" SET NOT NULL;

    ALTER TABLE "Interaction" RENAME COLUMN "userId" TO "ownerId";
    ALTER TABLE "Interaction"
      DROP COLUMN "metadata",
      ADD COLUMN "duration" INTEGER,
      ADD COLUMN "location" TEXT,
      ADD COLUMN "occurredAt" TIMESTAMP(3),
      ADD COLUMN "summary" TEXT,
      ADD COLUMN "title" TEXT,
      ADD COLUMN "updatedAt" TIMESTAMP(3);
    UPDATE "Interaction"
      SET "occurredAt" = "createdAt", "updatedAt" = "createdAt"
      WHERE "occurredAt" IS NULL OR "updatedAt" IS NULL;
    ALTER TABLE "Interaction"
      ALTER COLUMN "occurredAt" SET NOT NULL,
      ALTER COLUMN "occurredAt" SET DEFAULT CURRENT_TIMESTAMP,
      ALTER COLUMN "updatedAt" SET NOT NULL,
      ALTER COLUMN "xpEarned" SET DEFAULT 10;

    ALTER TABLE "Reminder" RENAME COLUMN "userId" TO "ownerId";
    ALTER TABLE "Reminder" RENAME COLUMN "dueDate" TO "scheduledAt";
    ALTER TABLE "Reminder" RENAME COLUMN "recurring" TO "repeatInterval";
    ALTER TABLE "Reminder"
      ADD COLUMN "completedAt" TIMESTAMP(3),
      ADD COLUMN "isRecurring" BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending',
      ADD COLUMN "type" TEXT;
    UPDATE "Reminder"
      SET "completedAt" = CASE WHEN "isCompleted" THEN "updatedAt" ELSE NULL END,
          "isRecurring" = ("repeatInterval" IS NOT NULL),
          "status" = CASE WHEN "isCompleted" THEN 'completed' ELSE 'pending' END,
          "type" = 'custom';
    ALTER TABLE "Reminder"
      ALTER COLUMN "type" SET NOT NULL,
      DROP COLUMN "isAI",
      DROP COLUMN "isCompleted",
      DROP COLUMN "xpReward";

    ALTER TABLE "Task" RENAME COLUMN "userId" TO "ownerId";
    ALTER TABLE "Task"
      ADD COLUMN "completedAt" TIMESTAMP(3),
      ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending';
    UPDATE "Task"
      SET "completedAt" = CASE WHEN "isCompleted" THEN "updatedAt" ELSE NULL END,
          "status" = CASE WHEN "isCompleted" THEN 'completed' ELSE 'pending' END;
    ALTER TABLE "Task"
      ALTER COLUMN "contactId" DROP NOT NULL,
      DROP COLUMN "isCompleted",
      DROP COLUMN "xpReward";

    ALTER TABLE "Gift"
      ADD COLUMN "givenAt" TIMESTAMP(3),
      ADD COLUMN "imageUrl" TEXT,
      ADD COLUMN "price" DECIMAL(10,2),
      ADD COLUMN "status" TEXT NOT NULL DEFAULT 'idea',
      ADD COLUMN "updatedAt" TIMESTAMP(3),
      ADD COLUMN "url" TEXT;
    UPDATE "Gift"
      SET "givenAt" = "giftDate",
          "price" = CASE WHEN "costCents" IS NULL THEN NULL ELSE "costCents"::DECIMAL / 100 END,
          "status" = CASE WHEN "isPurchased" THEN 'purchased' ELSE 'idea' END,
          "updatedAt" = "createdAt";
    ALTER TABLE "Gift"
      ALTER COLUMN "updatedAt" SET NOT NULL,
      DROP COLUMN "costCents",
      DROP COLUMN "currency",
      DROP COLUMN "giftDate",
      DROP COLUMN "isPurchased",
      DROP COLUMN "notes",
      DROP COLUMN "userId";

    ALTER TABLE "Activity" RENAME COLUMN "name" TO "title";
    ALTER TABLE "Activity" RENAME COLUMN "userId" TO "ownerId";
    ALTER TABLE "Activity" RENAME COLUMN "activityDate" TO "date";
    ALTER TABLE "Activity"
      ADD COLUMN "category" TEXT,
      ADD COLUMN "updatedAt" TIMESTAMP(3);
    UPDATE "Activity"
      SET "category" = 'custom',
          "date" = COALESCE("date", "createdAt"),
          "updatedAt" = "createdAt";
    ALTER TABLE "Activity"
      ALTER COLUMN "category" SET NOT NULL,
      ALTER COLUMN "date" SET NOT NULL,
      ALTER COLUMN "updatedAt" SET NOT NULL,
      ALTER COLUMN "contactId" DROP NOT NULL,
      DROP COLUMN "duration",
      DROP COLUMN "notes",
      DROP COLUMN "xpEarned";

    ALTER TABLE "Achievement" RENAME COLUMN "slug" TO "code";
    ALTER TABLE "Achievement" ADD COLUMN "requirement" JSONB;
    UPDATE "Achievement" SET "requirement" = '{"type":"legacy"}'::JSONB;
    ALTER TABLE "Achievement" ALTER COLUMN "requirement" SET NOT NULL;

    ALTER TABLE "UserAchievement" RENAME COLUMN "earnedAt" TO "unlockedAt";
    ALTER TABLE "Session" DROP COLUMN IF EXISTS "updatedAt";
  END IF;
END $$;

ALTER TABLE "ContactCelebration" ADD COLUMN IF NOT EXISTS "sendAt" TIMESTAMP(3);
ALTER TABLE "VaultMember" ALTER COLUMN "role" SET DEFAULT 'member';

DROP INDEX IF EXISTS "Achievement_slug_key";
DROP INDEX IF EXISTS "Activity_userId_idx";
DROP INDEX IF EXISTS "Contact_name_idx";
DROP INDEX IF EXISTS "Gift_userId_idx";
DROP INDEX IF EXISTS "Interaction_createdAt_idx";
DROP INDEX IF EXISTS "Interaction_userId_idx";
DROP INDEX IF EXISTS "Reminder_dueDate_idx";
DROP INDEX IF EXISTS "Reminder_userId_idx";
DROP INDEX IF EXISTS "Task_userId_idx";
DROP INDEX IF EXISTS "User_email_idx";
DROP INDEX IF EXISTS "Vault_ownerId_idx";
DROP INDEX IF EXISTS "VaultMember_userId_idx";

CREATE TABLE IF NOT EXISTS "DungeonMasterScenario" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "archetype" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "openingText" TEXT NOT NULL,
  "scenes" JSONB NOT NULL,
  "xpReward" INTEGER NOT NULL DEFAULT 100,
  "totalScenes" INTEGER NOT NULL DEFAULT 3,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DungeonMasterScenario_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DMSession" (
  "id" TEXT NOT NULL,
  "scenarioId" TEXT NOT NULL,
  "participants" TEXT[],
  "currentScene" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL,
  "currentNarrative" TEXT,
  "startedAt" TIMESTAMP(3),
  "deadline" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DMSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DMSceneResponse" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sceneIndex" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DMSceneResponse_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DungeonMasterScenario_archetype_idx" ON "DungeonMasterScenario"("archetype");
CREATE INDEX IF NOT EXISTS "DMSession_scenarioId_idx" ON "DMSession"("scenarioId");
CREATE INDEX IF NOT EXISTS "DMSession_status_idx" ON "DMSession"("status");
CREATE INDEX IF NOT EXISTS "DMSession_deadline_idx" ON "DMSession"("deadline");
CREATE INDEX IF NOT EXISTS "DMSceneResponse_sessionId_idx" ON "DMSceneResponse"("sessionId");
CREATE INDEX IF NOT EXISTS "DMSceneResponse_userId_idx" ON "DMSceneResponse"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "DMSceneResponse_sessionId_userId_sceneIndex_key" ON "DMSceneResponse"("sessionId", "userId", "sceneIndex");
CREATE UNIQUE INDEX IF NOT EXISTS "Achievement_code_key" ON "Achievement"("code");
CREATE INDEX IF NOT EXISTS "Activity_ownerId_idx" ON "Activity"("ownerId");
CREATE INDEX IF NOT EXISTS "Contact_lastContactedAt_idx" ON "Contact"("lastContactedAt");
CREATE INDEX IF NOT EXISTS "Contact_nextReminderAt_idx" ON "Contact"("nextReminderAt");
CREATE INDEX IF NOT EXISTS "Interaction_ownerId_idx" ON "Interaction"("ownerId");
CREATE INDEX IF NOT EXISTS "Interaction_occurredAt_idx" ON "Interaction"("occurredAt");
CREATE INDEX IF NOT EXISTS "Reminder_ownerId_idx" ON "Reminder"("ownerId");
CREATE INDEX IF NOT EXISTS "Reminder_scheduledAt_idx" ON "Reminder"("scheduledAt");
CREATE INDEX IF NOT EXISTS "Reminder_status_idx" ON "Reminder"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "Session_token_key" ON "Session"("token");
CREATE INDEX IF NOT EXISTS "Task_ownerId_idx" ON "Task"("ownerId");
CREATE INDEX IF NOT EXISTS "Task_status_idx" ON "Task"("status");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Interaction_ownerId_fkey') THEN
    ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Reminder_ownerId_fkey') THEN
    ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_ownerId_fkey"
      FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Task_contactId_fkey') THEN
    ALTER TABLE "Task" ADD CONSTRAINT "Task_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Activity_contactId_fkey') THEN
    ALTER TABLE "Activity" ADD CONSTRAINT "Activity_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DMSession_scenarioId_fkey') THEN
    ALTER TABLE "DMSession" ADD CONSTRAINT "DMSession_scenarioId_fkey"
      FOREIGN KEY ("scenarioId") REFERENCES "DungeonMasterScenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DMSceneResponse_sessionId_fkey') THEN
    ALTER TABLE "DMSceneResponse" ADD CONSTRAINT "DMSceneResponse_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "DMSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
