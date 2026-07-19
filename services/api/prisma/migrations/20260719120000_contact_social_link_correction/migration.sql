BEGIN;

ALTER TABLE "ContactEnrichmentCandidate"
  ADD COLUMN "correctionKind" TEXT,
  ADD COLUMN "previousValue" JSONB;

ALTER TABLE "ContactEnrichmentCandidate"
  ADD CONSTRAINT "ContactEnrichmentCandidate_correctionKind_check" CHECK (
    "correctionKind" IS NULL OR "correctionKind" IN ('social_link_replace')
  );

COMMIT;
