-- Event discovery stores only certified public event metadata in plaintext.
-- Interest tags, source URLs, and provider event IDs remain encrypted at rest.

CREATE TABLE "EventPreference" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "interestTagsCiphertext" BYTEA NOT NULL,
  "interestTagsIv" BYTEA NOT NULL,
  "interestTagsTag" BYTEA NOT NULL,
  "interestTagsKeyVersion" INTEGER NOT NULL,
  "maxDistanceKm" DECIMAL(6,2) NOT NULL DEFAULT 50,
  "travelSpeedKph" INTEGER NOT NULL DEFAULT 30,
  "travelBufferMinutes" INTEGER NOT NULL DEFAULT 15,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventPreference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventPreference_interestTagsEnvelope_check" CHECK ("interestTagsKeyVersion" > 0 AND octet_length("interestTagsIv") = 12 AND octet_length("interestTagsTag") = 16),
  CONSTRAINT "EventPreference_maxDistanceKm_check" CHECK ("maxDistanceKm" BETWEEN 1 AND 500),
  CONSTRAINT "EventPreference_travelSpeedKph_check" CHECK ("travelSpeedKph" BETWEEN 1 AND 300),
  CONSTRAINT "EventPreference_travelBufferMinutes_check" CHECK ("travelBufferMinutes" BETWEEN 0 AND 240)
);

CREATE TABLE "EventSource" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'ics',
  "externalSourceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "feedUrlMac" TEXT NOT NULL,
  "feedUrlCiphertext" BYTEA NOT NULL,
  "feedUrlIv" BYTEA NOT NULL,
  "feedUrlTag" BYTEA NOT NULL,
  "feedUrlKeyVersion" INTEGER NOT NULL,
  "allowedHost" TEXT NOT NULL,
  "city" TEXT,
  "countryCode" TEXT,
  "socialWeight" INTEGER NOT NULL DEFAULT 5,
  "status" TEXT NOT NULL DEFAULT 'active',
  "pollIntervalMinutes" INTEGER NOT NULL DEFAULT 60,
  "nextPollAt" TIMESTAMP(3) NOT NULL,
  "leaseUntil" TIMESTAMP(3),
  "lastPolledAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventSource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventSource_provider_check" CHECK ("provider" = 'ics'),
  CONSTRAINT "EventSource_feedUrlMac_check" CHECK ("feedUrlMac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "EventSource_feedUrlEnvelope_check" CHECK ("feedUrlKeyVersion" > 0 AND octet_length("feedUrlIv") = 12 AND octet_length("feedUrlTag") = 16),
  CONSTRAINT "EventSource_countryCode_check" CHECK ("countryCode" IS NULL OR "countryCode" ~ '^[A-Z]{2}$'),
  CONSTRAINT "EventSource_socialWeight_check" CHECK ("socialWeight" BETWEEN 0 AND 10),
  CONSTRAINT "EventSource_status_check" CHECK ("status" IN ('active', 'disabled', 'error')),
  CONSTRAINT "EventSource_pollIntervalMinutes_check" CHECK ("pollIntervalMinutes" BETWEEN 15 AND 1440)
);

CREATE TABLE "DiscoveredEvent" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "providerEventIdMac" TEXT NOT NULL,
  "providerEventIdCiphertext" BYTEA NOT NULL,
  "providerEventIdIv" BYTEA NOT NULL,
  "providerEventIdTag" BYTEA NOT NULL,
  "providerEventIdKeyVersion" INTEGER NOT NULL,
  "canonicalMac" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "descriptionExcerpt" TEXT,
  "url" TEXT,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "timeZone" TEXT,
  "venueName" TEXT,
  "address" TEXT,
  "city" TEXT,
  "countryCode" TEXT,
  "latitude" DECIMAL(9,6),
  "longitude" DECIMAL(9,6),
  "category" TEXT,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'scheduled',
  "sourceUpdatedAt" TIMESTAMP(3),
  "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DiscoveredEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiscoveredEvent_providerEventIdMac_check" CHECK ("providerEventIdMac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "DiscoveredEvent_providerEventIdEnvelope_check" CHECK ("providerEventIdKeyVersion" > 0 AND octet_length("providerEventIdIv") = 12 AND octet_length("providerEventIdTag") = 16),
  CONSTRAINT "DiscoveredEvent_canonicalMac_check" CHECK ("canonicalMac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "DiscoveredEvent_countryCode_check" CHECK ("countryCode" IS NULL OR "countryCode" ~ '^[A-Z]{2}$'),
  CONSTRAINT "DiscoveredEvent_status_check" CHECK ("status" IN ('scheduled', 'cancelled', 'expired')),
  CONSTRAINT "DiscoveredEvent_timeRange_check" CHECK ("endAt" > "startAt"),
  CONSTRAINT "DiscoveredEvent_coordinates_check" CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL)
    OR (
      "latitude" IS NOT NULL AND "longitude" IS NOT NULL
      AND "latitude" BETWEEN -90 AND 90
      AND "longitude" BETWEEN -180 AND 180
    )
  )
);

CREATE UNIQUE INDEX "EventPreference_ownerId_key" ON "EventPreference"("ownerId");
CREATE UNIQUE INDEX "EventPreference_id_ownerId_key" ON "EventPreference"("id", "ownerId");

CREATE UNIQUE INDEX "EventSource_ownerId_provider_externalSourceId_key" ON "EventSource"("ownerId", "provider", "externalSourceId");
CREATE UNIQUE INDEX "EventSource_ownerId_feedUrlMac_key" ON "EventSource"("ownerId", "feedUrlMac");
CREATE UNIQUE INDEX "EventSource_id_ownerId_key" ON "EventSource"("id", "ownerId");
CREATE INDEX "EventSource_status_nextPollAt_leaseUntil_idx" ON "EventSource"("status", "nextPollAt", "leaseUntil");

CREATE UNIQUE INDEX "DiscoveredEvent_sourceId_providerEventIdMac_key" ON "DiscoveredEvent"("sourceId", "providerEventIdMac");
CREATE UNIQUE INDEX "DiscoveredEvent_id_ownerId_key" ON "DiscoveredEvent"("id", "ownerId");
CREATE INDEX "DiscoveredEvent_ownerId_startAt_status_city_idx" ON "DiscoveredEvent"("ownerId", "startAt", "status", "city");
CREATE INDEX "DiscoveredEvent_sourceId_canonicalMac_idx" ON "DiscoveredEvent"("sourceId", "canonicalMac");

ALTER TABLE "EventPreference"
  ADD CONSTRAINT "EventPreference_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventSource"
  ADD CONSTRAINT "EventSource_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DiscoveredEvent"
  ADD CONSTRAINT "DiscoveredEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DiscoveredEvent_sourceId_ownerId_fkey" FOREIGN KEY ("sourceId", "ownerId") REFERENCES "EventSource"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;
