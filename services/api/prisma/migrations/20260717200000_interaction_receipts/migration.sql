CREATE UNIQUE INDEX "Interaction_id_ownerId_key"
  ON "Interaction"("id", "ownerId");

CREATE TABLE "InteractionReceipt" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "interactionId" TEXT NOT NULL,
  "previousLastContactedAt" TIMESTAMP(3),
  "resultingLastContactedAt" TIMESTAMP(3),
  "lastContactAdvanced" BOOLEAN NOT NULL,
  "interactionXpDelta" INTEGER NOT NULL,
  "achievementXpDelta" INTEGER NOT NULL,
  "totalXpDelta" INTEGER NOT NULL,
  "totalXpAfter" INTEGER NOT NULL,
  "levelAfter" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InteractionReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InteractionReceipt_interactionId_key"
  ON "InteractionReceipt"("interactionId");
CREATE UNIQUE INDEX "InteractionReceipt_interactionId_ownerId_key"
  ON "InteractionReceipt"("interactionId", "ownerId");
CREATE INDEX "InteractionReceipt_ownerId_createdAt_idx"
  ON "InteractionReceipt"("ownerId", "createdAt");

ALTER TABLE "InteractionReceipt"
  ADD CONSTRAINT "InteractionReceipt_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InteractionReceipt"
  ADD CONSTRAINT "InteractionReceipt_interactionId_ownerId_fkey"
  FOREIGN KEY ("interactionId", "ownerId") REFERENCES "Interaction"("id", "ownerId")
  ON DELETE CASCADE ON UPDATE CASCADE;
