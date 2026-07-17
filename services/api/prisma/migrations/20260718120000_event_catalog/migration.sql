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
  "license" TEXT NOT NULL,
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
  "sourceId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "socialWeight" INTEGER NOT NULL DEFAULT 5,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventCatalogFollow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventCatalogFollow_status_check" CHECK ("status" IN ('active', 'paused')),
  CONSTRAINT "EventCatalogFollow_socialWeight_check" CHECK ("socialWeight" BETWEEN 0 AND 10),
  CONSTRAINT "EventCatalogFollow_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EventCatalogFollow_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "EventCatalogListing"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "EventCatalogFollow_sourceId_ownerId_fkey" FOREIGN KEY ("sourceId", "ownerId") REFERENCES "EventSource"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EventCatalogListing_slug_key" ON "EventCatalogListing"("slug");
CREATE INDEX "EventCatalogListing_status_kind_trustTier_slug_idx" ON "EventCatalogListing"("status", "kind", "trustTier", "slug");
CREATE INDEX "EventCatalogListing_city_status_slug_idx" ON "EventCatalogListing"("city", "status", "slug");
CREATE INDEX "EventCatalogListing_search_idx" ON "EventCatalogListing" USING GIN (to_tsvector('simple', "title" || ' ' || "summary"));
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
  "freshnessSlaHours", "license", "attribution", "connectorType",
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
    'official-public-information', 'United Arab Emirates Government',
    'official_page', 'uae-government-public-holidays',
    '9a739060418cd44808e6710feaee603a6c61ac9ab37d4de8caa6b12820cab853',
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
    'un-terms-of-use', 'United Nations', 'official_page', 'un-international-days',
    'bfbef4ba05c81f6e5a34c6f661c64b33355a8ee86d27da7781ab9acc4f1a7ae6',
    '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
  ),
  (
    'catalog-jewish-holidays-diaspora', 'jewish-holidays-diaspora', 'Jewish holidays (Diaspora)',
    'Jewish holiday dates for communities outside Israel.', ARRAY['hebcal diaspora holidays'],
    ARRAY['diaspora', 'jewish', 'religious'], 'religious_observances', 'active',
    'global', ARRAY[]::TEXT[], ARRAY[]::TEXT[], NULL, false, 'authoritative',
    'calculated', 'https://www.hebcal.com/holidays/', 'seed-2026-07-18',
    '2026-07-18T00:00:00.000Z', 720, 'CC-BY-4.0', 'Hebcal.com', 'hebcal_api',
    'hebcal-diaspora', '5b6d09fb7ce119401d6561a12b87b6d55bb1108a0daf8e8dec4c6863cb310e7c',
    '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
  ),
  (
    'catalog-jewish-holidays-israel', 'jewish-holidays-israel', 'Jewish holidays (Israel)',
    'Jewish holiday dates using the Israeli holiday schedule.', ARRAY['hebcal israel holidays'],
    ARRAY['israel', 'jewish', 'religious'], 'religious_observances', 'active',
    'country', ARRAY['IL'], ARRAY[]::TEXT[], NULL, false, 'authoritative',
    'calculated', 'https://www.hebcal.com/holidays/', 'seed-2026-07-18',
    '2026-07-18T00:00:00.000Z', 720, 'CC-BY-4.0', 'Hebcal.com', 'hebcal_api',
    'hebcal-israel', '02303926524ad204bc86fba42c8df5c3ca7d1ed78f10f7f8fa9626d269f871fc',
    '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
  ),
  (
    'catalog-gitex-global', 'gitex-global', 'GITEX Global',
    'Official GITEX Global technology conference announcements.', ARRAY['gitex'],
    ARRAY['ai', 'business', 'conference', 'technology'], 'conference_series', 'active',
    'city', ARRAY['AE'], ARRAY['AE-DU'], 'Dubai', false, 'official', 'confirmed',
    'https://www.gitex.com/', 'seed-2026-07-18', '2026-07-18T00:00:00.000Z', 168,
    'official-event-information', 'Dubai World Trade Centre', 'official_page', 'gitex-global',
    'e7751f6d638654e41008e668509442ad983cd2b567b9a561d3c437b34d0f99ef',
    '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
  ),
  (
    'catalog-ai-everything-global', 'ai-everything-global', 'AI Everything Global',
    'Official AI Everything Global conference announcements.', ARRAY['ai everything'],
    ARRAY['ai', 'business', 'conference', 'technology'], 'conference_series', 'active',
    'country', ARRAY['AE'], ARRAY[]::TEXT[], NULL, false, 'official', 'confirmed',
    'https://www.aieverythingglobal.com/', 'seed-2026-07-18',
    '2026-07-18T00:00:00.000Z', 168, 'official-event-information',
    'Dubai World Trade Centre', 'official_page', 'ai-everything-global',
    'c9b3aa5fb548cbd85418605bac92edd9d099816cafd5a8d60b0dbc2070f72ce8',
    '2026-07-18T00:00:00.000Z', '2026-07-18T00:00:00.000Z'
  );

COMMIT;
