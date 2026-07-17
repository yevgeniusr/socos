BEGIN;

CREATE TABLE "EventCatalogListing" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "geographicScope" TEXT NOT NULL,
  "countries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "subdivisions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "city" TEXT,
  "online" BOOLEAN NOT NULL DEFAULT false,
  "trustTier" TEXT NOT NULL,
  "dateCertainty" TEXT NOT NULL,
  "provenanceUrl" TEXT NOT NULL,
  "sourceRevision" TEXT NOT NULL,
  "checkedAt" TIMESTAMP(3) NOT NULL,
  "freshnessSlaHours" INTEGER NOT NULL,
  "rightsBasis" TEXT NOT NULL,
  "termsUrl" TEXT,
  "attribution" TEXT NOT NULL,
  "connectorType" TEXT NOT NULL,
  "connectorReference" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventCatalogListing_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventCatalogListing_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT "EventCatalogListing_status_check" CHECK ("status" IN ('active', 'paused', 'retired')),
  CONSTRAINT "EventCatalogListing_scope_check" CHECK ("geographicScope" IN ('global', 'country', 'subdivision', 'city')),
  CONSTRAINT "EventCatalogListing_trust_check" CHECK ("trustTier" IN ('official', 'authoritative', 'reviewed')),
  CONSTRAINT "EventCatalogListing_certainty_check" CHECK ("dateCertainty" IN ('confirmed', 'tentative', 'calculated')),
  CONSTRAINT "EventCatalogListing_freshness_check" CHECK ("freshnessSlaHours" BETWEEN 1 AND 8760),
  CONSTRAINT "EventCatalogListing_rightsBasis_check" CHECK ("rightsBasis" IN ('metadata_only', 'source_terms', 'cc_by_4_0')),
  CONSTRAINT "EventCatalogListing_termsUrl_check" CHECK (
    ("termsUrl" IS NULL OR "termsUrl" ~ '^https://') AND
    ("rightsBasis" = 'metadata_only' OR "termsUrl" IS NOT NULL)
  ),
  CONSTRAINT "EventCatalogListing_contentHash_check" CHECK ("contentHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "EventCatalogListing_countries_check" CHECK (
    cardinality("countries") = 0 OR array_to_string("countries", ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'
  ),
  CONSTRAINT "EventCatalogListing_subdivisions_check" CHECK (
    cardinality("subdivisions") = 0 OR array_to_string("subdivisions", ',') ~ '^[A-Z]{2}-[A-Z0-9]{1,3}(,[A-Z]{2}-[A-Z0-9]{1,3})*$'
  )
);

CREATE TABLE "EventCatalogFollow" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "listingId" TEXT NOT NULL,
  "sourceId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "socialWeight" INTEGER NOT NULL DEFAULT 5,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventCatalogFollow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventCatalogFollow_status_check" CHECK ("status" IN ('active', 'paused')),
  CONSTRAINT "EventCatalogFollow_socialWeight_check" CHECK ("socialWeight" BETWEEN 0 AND 10),
  CONSTRAINT "EventCatalogFollow_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EventCatalogFollow_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "EventCatalogListing"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EventCatalogFollow_sourceId_ownerId_fkey" FOREIGN KEY ("sourceId", "ownerId") REFERENCES "EventSource"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EventCatalogListing_slug_key" ON "EventCatalogListing"("slug");
CREATE INDEX "EventCatalogListing_status_kind_trustTier_slug_idx" ON "EventCatalogListing"("status", "kind", "trustTier", "slug");
CREATE INDEX "EventCatalogListing_city_status_slug_idx" ON "EventCatalogListing"("city", "status", "slug");
CREATE INDEX "EventCatalogListing_aliases_idx" ON "EventCatalogListing" USING GIN ("aliases");
CREATE INDEX "EventCatalogListing_tags_idx" ON "EventCatalogListing" USING GIN ("tags");
CREATE INDEX "EventCatalogListing_countries_idx" ON "EventCatalogListing" USING GIN ("countries");
CREATE UNIQUE INDEX "EventCatalogFollow_ownerId_listingId_key" ON "EventCatalogFollow"("ownerId", "listingId");
CREATE UNIQUE INDEX "EventCatalogFollow_sourceId_ownerId_key" ON "EventCatalogFollow"("sourceId", "ownerId");
CREATE UNIQUE INDEX "EventCatalogFollow_id_ownerId_key" ON "EventCatalogFollow"("id", "ownerId");
CREATE INDEX "EventCatalogFollow_ownerId_status_updatedAt_idx" ON "EventCatalogFollow"("ownerId", "status", "updatedAt");

INSERT INTO "EventCatalogListing" (
  "id", "slug", "title", "summary", "aliases", "tags", "kind", "status",
  "geographicScope", "countries", "subdivisions", "city", "online",
  "trustTier", "dateCertainty", "provenanceUrl", "sourceRevision", "checkedAt",
  "freshnessSlaHours", "rightsBasis", "termsUrl", "attribution", "connectorType",
  "connectorReference", "contentHash", "createdAt", "updatedAt"
) VALUES
  (
    'catalog-uae-public-holidays', 'uae-public-holidays', 'UAE public holidays',
    'Official public holiday announcements for the United Arab Emirates.',
    ARRAY['united arab emirates holidays'], ARRAY['holidays', 'uae', 'government'],
    'country_holidays', 'active', 'country', ARRAY['AE'], ARRAY[]::TEXT[], NULL,
    false, 'official', 'tentative',
    'https://u.ae/en/information-and-services/public-holidays-and-religious-affairs/public-holidays',
    'seed-2026-07-18', '2026-07-18T00:00:00.000Z', 168,
    'metadata_only', NULL, 'United Arab Emirates Government',
    'official_page', 'uae-government-public-holidays',
    '1e68d494fe7c62d87a8b27817a1de5c9096daed6de730112e85f868d0c954c72',
    '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
  ),
  (
    'catalog-un-international-days', 'un-international-days', 'UN International Days and Weeks',
    'International observances designated by the United Nations.',
    ARRAY['un observances', 'united nations international days'],
    ARRAY['global', 'international', 'observances', 'un'],
    'global_celebrations', 'active', 'global', ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL,
    true, 'official', 'confirmed', 'https://www.un.org/en/observances/list-days-weeks',
    'seed-2026-07-18', '2026-07-18T00:00:00.000Z', 720,
    'source_terms', 'https://www.un.org/en/about-us/terms-of-use',
    'United Nations', 'official_page', 'un-international-days',
    'c3c8b55fd189dca932084d4d3c56e4893181e171619f2a19f9c979bb99b3030f',
    '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
  ),
  (
    'catalog-jewish-holidays-diaspora', 'jewish-holidays-diaspora', 'Jewish holidays (Diaspora)',
    'Jewish holiday dates for communities outside Israel.', ARRAY['hebcal diaspora holidays'],
    ARRAY['diaspora', 'jewish', 'religious'], 'religious_observances', 'active',
    'global', ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, false, 'authoritative',
    'calculated', 'https://www.hebcal.com/holidays/', 'seed-2026-07-18',
    '2026-07-18T00:00:00.000Z', 720, 'cc_by_4_0',
    'https://creativecommons.org/licenses/by/4.0/', 'Hebcal.com', 'hebcal_api',
    'hebcal-diaspora', 'b0630c80d837181fea4e9b0b68a6eef8a9397663611ea6aee480776c8d212042',
    '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
  ),
  (
    'catalog-jewish-holidays-israel', 'jewish-holidays-israel', 'Jewish holidays (Israel)',
    'Jewish holiday dates using the Israeli holiday schedule.', ARRAY['hebcal israel holidays'],
    ARRAY['israel', 'jewish', 'religious'], 'religious_observances', 'active',
    'country', ARRAY['IL'], ARRAY[]::TEXT[], NULL, false, 'authoritative',
    'calculated', 'https://www.hebcal.com/holidays/', 'seed-2026-07-18',
    '2026-07-18T00:00:00.000Z', 720, 'cc_by_4_0',
    'https://creativecommons.org/licenses/by/4.0/', 'Hebcal.com', 'hebcal_api',
    'hebcal-israel', '6651383677dae86c0604e0cf509145eee64a39632d00568ce675971e864ee621',
    '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
  ),
  (
    'catalog-gitex-global', 'gitex-global', 'GITEX Global',
    'Official GITEX Global technology conference announcements.', ARRAY['gitex'],
    ARRAY['ai', 'business', 'conference', 'technology'], 'conference_series', 'active',
    'city', ARRAY['AE'], ARRAY['AE-DU'], 'Dubai', false, 'official', 'confirmed',
    'https://www.gitex.com/', 'seed-2026-07-18', '2026-07-18T00:00:00.000Z', 168,
    'metadata_only', NULL, 'Dubai World Trade Centre', 'official_page', 'gitex-global',
    '3924ddee65b87ac08de9498c9869c7ebd401b7505bfc76f1dc33c66c9a5d7018',
    '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
  ),
  (
    'catalog-ai-everything-global', 'ai-everything-global', 'AI Everything Global',
    'Official AI Everything Global conference announcements.', ARRAY['ai everything'],
    ARRAY['ai', 'business', 'conference', 'technology'], 'conference_series', 'active',
    'country', ARRAY['AE'], ARRAY[]::TEXT[], NULL, false, 'official', 'confirmed',
    'https://www.aieverythingglobal.com/', 'seed-2026-07-18',
    '2026-07-18T00:00:00.000Z', 168, 'metadata_only', NULL,
    'Dubai World Trade Centre', 'official_page', 'ai-everything-global',
    '86f5f593c5edbdf9b1827590fdf09835e6b2a7316f45e242d77a770036f41132',
    '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
  );

COMMIT;
