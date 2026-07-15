BEGIN;

ALTER TABLE "Contact"
  ADD COLUMN "groups" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sourceSystem" TEXT,
  ADD COLUMN "sourceId" TEXT,
  ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "importedAt" TIMESTAMP(3),
  ADD CONSTRAINT "Contact_source_pair_check" CHECK (
    ("sourceSystem" IS NULL) = ("sourceId" IS NULL)
  );

CREATE UNIQUE INDEX "Contact_ownerId_sourceSystem_sourceId_key"
  ON "Contact"("ownerId", "sourceSystem", "sourceId");
CREATE INDEX "Contact_ownerId_isDemo_idx"
  ON "Contact"("ownerId", "isDemo");

COMMIT;
