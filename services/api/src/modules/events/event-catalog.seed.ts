import { createHash } from "node:crypto";

export interface EventCatalogSeedItem {
  id: string;
  slug: string;
  title: string;
  summary: string;
  aliases: readonly string[];
  tags: readonly string[];
  kind: string;
  status: "active";
  geographicScope: "country" | "global" | "city";
  countries: readonly string[];
  subdivisions: readonly string[];
  city: string | null;
  online: boolean;
  trustTier: "official" | "authoritative";
  dateCertainty: "confirmed" | "tentative" | "calculated";
  provenanceUrl: string;
  sourceRevision: "seed-2026-07-18";
  checkedAt: "2026-07-18T00:00:00.000Z";
  freshnessSlaHours: number;
  rightsBasis: "metadata_only" | "source_terms" | "cc_by_4_0";
  termsUrl: string | null;
  attribution: string;
  connectorType: string;
  connectorReference: string;
}

const common = {
  status: "active" as const,
  sourceRevision: "seed-2026-07-18" as const,
  checkedAt: "2026-07-18T00:00:00.000Z" as const,
};

export const EVENT_CATALOG_SEED_MANIFEST: readonly EventCatalogSeedItem[] = [
  {
    ...common,
    id: "catalog-uae-public-holidays",
    slug: "uae-public-holidays",
    title: "UAE public holidays",
    summary: "Official public holiday announcements for the United Arab Emirates.",
    aliases: ["united arab emirates holidays"],
    tags: ["holidays", "uae", "government"],
    kind: "country_holidays",
    geographicScope: "country",
    countries: ["AE"],
    subdivisions: [],
    city: null,
    online: false,
    trustTier: "official",
    dateCertainty: "tentative",
    provenanceUrl:
      "https://u.ae/en/information-and-services/public-holidays-and-religious-affairs/public-holidays",
    freshnessSlaHours: 168,
    rightsBasis: "metadata_only",
    termsUrl: null,
    attribution: "United Arab Emirates Government",
    connectorType: "official_page",
    connectorReference: "uae-government-public-holidays",
  },
  {
    ...common,
    id: "catalog-un-international-days",
    slug: "un-international-days",
    title: "UN International Days and Weeks",
    summary: "International observances designated by the United Nations.",
    aliases: ["un observances", "united nations international days"],
    tags: ["global", "international", "observances", "un"],
    kind: "global_celebrations",
    geographicScope: "global",
    countries: [],
    subdivisions: [],
    city: null,
    online: true,
    trustTier: "official",
    dateCertainty: "confirmed",
    provenanceUrl: "https://www.un.org/en/observances/list-days-weeks",
    freshnessSlaHours: 720,
    rightsBasis: "source_terms",
    termsUrl: "https://www.un.org/en/about-us/terms-of-use",
    attribution: "United Nations",
    connectorType: "official_page",
    connectorReference: "un-international-days",
  },
  {
    ...common,
    id: "catalog-jewish-holidays-diaspora",
    slug: "jewish-holidays-diaspora",
    title: "Jewish holidays (Diaspora)",
    summary: "Jewish holiday dates for communities outside Israel.",
    aliases: ["hebcal diaspora holidays"],
    tags: ["diaspora", "jewish", "religious"],
    kind: "religious_observances",
    geographicScope: "global",
    countries: [],
    subdivisions: [],
    city: null,
    online: false,
    trustTier: "authoritative",
    dateCertainty: "calculated",
    provenanceUrl: "https://www.hebcal.com/holidays/",
    freshnessSlaHours: 720,
    rightsBasis: "cc_by_4_0",
    termsUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Hebcal.com",
    connectorType: "hebcal_api",
    connectorReference: "hebcal-diaspora",
  },
  {
    ...common,
    id: "catalog-jewish-holidays-israel",
    slug: "jewish-holidays-israel",
    title: "Jewish holidays (Israel)",
    summary: "Jewish holiday dates using the Israeli holiday schedule.",
    aliases: ["hebcal israel holidays"],
    tags: ["israel", "jewish", "religious"],
    kind: "religious_observances",
    geographicScope: "country",
    countries: ["IL"],
    subdivisions: [],
    city: null,
    online: false,
    trustTier: "authoritative",
    dateCertainty: "calculated",
    provenanceUrl: "https://www.hebcal.com/holidays/",
    freshnessSlaHours: 720,
    rightsBasis: "cc_by_4_0",
    termsUrl: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Hebcal.com",
    connectorType: "hebcal_api",
    connectorReference: "hebcal-israel",
  },
  {
    ...common,
    id: "catalog-gitex-global",
    slug: "gitex-global",
    title: "GITEX Global",
    summary: "Official GITEX Global technology conference announcements.",
    aliases: ["gitex"],
    tags: ["ai", "business", "conference", "technology"],
    kind: "conference_series",
    geographicScope: "city",
    countries: ["AE"],
    subdivisions: ["AE-DU"],
    city: "Dubai",
    online: false,
    trustTier: "official",
    dateCertainty: "confirmed",
    provenanceUrl: "https://www.gitex.com/",
    freshnessSlaHours: 168,
    rightsBasis: "metadata_only",
    termsUrl: null,
    attribution: "Dubai World Trade Centre",
    connectorType: "official_page",
    connectorReference: "gitex-global",
  },
  {
    ...common,
    id: "catalog-ai-everything-global",
    slug: "ai-everything-global",
    title: "AI Everything Global",
    summary: "Official AI Everything Global conference announcements.",
    aliases: ["ai everything"],
    tags: ["ai", "business", "conference", "technology"],
    kind: "conference_series",
    geographicScope: "country",
    countries: ["AE"],
    subdivisions: [],
    city: null,
    online: false,
    trustTier: "official",
    dateCertainty: "confirmed",
    provenanceUrl: "https://www.aieverythingglobal.com/",
    freshnessSlaHours: 168,
    rightsBasis: "metadata_only",
    termsUrl: null,
    attribution: "Dubai World Trade Centre",
    connectorType: "official_page",
    connectorReference: "ai-everything-global",
  },
];

export function eventCatalogSeedContentHash(item: EventCatalogSeedItem): string {
  return createHash("sha256").update(JSON.stringify(item)).digest("hex");
}
