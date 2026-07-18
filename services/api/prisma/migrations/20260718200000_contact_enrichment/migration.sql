BEGIN;

ALTER TABLE "Contact"
  ADD COLUMN "birthdayMonth" INTEGER,
  ADD COLUMN "birthdayDay" INTEGER;

ALTER TABLE "Contact"
  ADD CONSTRAINT "Contact_birthday_parts_check" CHECK (
    ("birthdayMonth" IS NULL AND "birthdayDay" IS NULL)
    OR (
      "birthdayMonth" BETWEEN 1 AND 12
      AND "birthdayDay" >= 1
      AND "birthdayDay" <= CASE "birthdayMonth"
        WHEN 2 THEN 29
        WHEN 4 THEN 30
        WHEN 6 THEN 30
        WHEN 9 THEN 30
        WHEN 11 THEN 30
        ELSE 31
      END
    )
  );

CREATE UNIQUE INDEX "Contact_id_ownerId_key" ON "Contact"("id", "ownerId");

CREATE TABLE "ContactEnrichmentCandidate" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "fieldName" TEXT NOT NULL,
  "proposedValue" JSONB NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "sourceLocator" TEXT NOT NULL,
  "sourceReference" TEXT,
  "sourceRetrievedAt" TIMESTAMP(3) NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "matchRationale" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "contentHash" TEXT NOT NULL,
  "decidedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContactEnrichmentCandidate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContactEnrichmentCandidate_fieldName_check" CHECK (
    "fieldName" IN ('photo', 'bio', 'company', 'jobTitle', 'birthday', 'anniversary', 'socialLinks', 'firstMetDate', 'firstMetContext')
  ),
  CONSTRAINT "ContactEnrichmentCandidate_sourceKind_check" CHECK (
    "sourceKind" IN ('second_brain', 'arc_history', 'arc_sidebar', 'vcard', 'public_web')
  ),
  CONSTRAINT "ContactEnrichmentCandidate_status_check" CHECK (
    "status" IN ('pending', 'accepted', 'rejected', 'superseded')
  ),
  CONSTRAINT "ContactEnrichmentCandidate_confidence_check" CHECK (
    "confidence" >= 0 AND "confidence" <= 1
  ),
  CONSTRAINT "ContactEnrichmentCandidate_contentHash_check" CHECK (
    char_length("contentHash") = 64
  ),
  CONSTRAINT "ContactEnrichmentCandidate_locator_check" CHECK (
    char_length("sourceLocator") BETWEEN 1 AND 2048
  ),
  CONSTRAINT "ContactEnrichmentCandidate_reference_check" CHECK (
    "sourceReference" IS NULL OR char_length("sourceReference") <= 500
  ),
  CONSTRAINT "ContactEnrichmentCandidate_rationale_check" CHECK (
    char_length("matchRationale") BETWEEN 1 AND 1000
  )
);

CREATE UNIQUE INDEX "ContactEnrichmentCandidate_ownerId_contactId_contentHash_key"
  ON "ContactEnrichmentCandidate"("ownerId", "contactId", "contentHash");
CREATE INDEX "ContactEnrichmentCandidate_ownerId_contactId_status_created_idx"
  ON "ContactEnrichmentCandidate"("ownerId", "contactId", "status", "createdAt");
CREATE INDEX "ContactEnrichmentCandidate_ownerId_status_createdAt_idx"
  ON "ContactEnrichmentCandidate"("ownerId", "status", "createdAt");

ALTER TABLE "ContactEnrichmentCandidate"
  ADD CONSTRAINT "ContactEnrichmentCandidate_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ContactEnrichmentCandidate_contactId_ownerId_fkey"
    FOREIGN KEY ("contactId", "ownerId") REFERENCES "Contact"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
