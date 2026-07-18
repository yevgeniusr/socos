BEGIN;

ALTER TABLE "GoogleCalendarConnection"
  ADD COLUMN "providerAccountIdMac" TEXT,
  ADD COLUMN "providerAccountIdCiphertext" BYTEA,
  ADD COLUMN "providerAccountIdIv" BYTEA,
  ADD COLUMN "providerAccountIdTag" BYTEA,
  ADD COLUMN "providerAccountIdKeyVersion" INTEGER,
  ADD COLUMN "oauthGeneration" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CalendarEvent"
  ADD COLUMN "canonicalMac" TEXT;

ALTER TABLE "BriefItem"
  ADD COLUMN "sourceCanonicalMac" TEXT;

UPDATE "GoogleCalendarConnection" AS target
   SET "providerAccountIdMac" = source_identity."externalIdMac"
  FROM (
    SELECT DISTINCT ON ("connectionId")
           "connectionId", "externalIdMac"
      FROM "CalendarSource"
     ORDER BY "connectionId", "isPrimary" DESC, "createdAt", "id"
  ) AS source_identity
 WHERE source_identity."connectionId" = target."id"
   AND target."providerAccountIdMac" IS NULL;

DROP INDEX "GoogleCalendarConnection_ownerId_key";

ALTER TABLE "GoogleCalendarConnection"
  ADD CONSTRAINT "GoogleCalendarConnection_providerAccountIdMac_check" CHECK ("providerAccountIdMac" IS NULL OR "providerAccountIdMac" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "GoogleCalendarConnection_providerAccountIdEnvelope_check" CHECK (
    num_nonnulls("providerAccountIdCiphertext", "providerAccountIdIv", "providerAccountIdTag", "providerAccountIdKeyVersion") IN (0, 4)
    AND ("providerAccountIdKeyVersion" IS NULL OR ("providerAccountIdKeyVersion" > 0 AND octet_length("providerAccountIdIv") = 12 AND octet_length("providerAccountIdTag") = 16))
  ),
  ADD CONSTRAINT "GoogleCalendarConnection_oauthGeneration_check" CHECK ("oauthGeneration" >= 0);

ALTER TABLE "CalendarEvent"
  ADD CONSTRAINT "CalendarEvent_canonicalMac_check" CHECK ("canonicalMac" IS NULL OR "canonicalMac" ~ '^[0-9a-f]{64}$');

ALTER TABLE "BriefItem"
  ADD CONSTRAINT "BriefItem_sourceCanonicalMac_check" CHECK ("sourceCanonicalMac" IS NULL OR "sourceCanonicalMac" ~ '^[0-9a-f]{64}$');

CREATE UNIQUE INDEX "GoogleCalendarConnection_ownerId_providerAccountIdMac_key"
  ON "GoogleCalendarConnection"("ownerId", "providerAccountIdMac");

CREATE INDEX "CalendarEvent_ownerId_canonicalMac_idx"
  ON "CalendarEvent"("ownerId", "canonicalMac");

CREATE INDEX "BriefItem_ownerId_sourceType_sourceCanonicalMac_idx"
  ON "BriefItem"("ownerId", "sourceType", "sourceCanonicalMac");

COMMIT;
