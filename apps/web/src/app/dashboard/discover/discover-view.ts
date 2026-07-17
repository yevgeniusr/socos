export interface EventCatalogFollow {
  status: string;
  socialWeight: number;
}

export interface EventCatalogOccurrence {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  timeZone: string | null;
  city: string | null;
  countryCode: string | null;
}

export interface EventCatalogItem {
  id: string;
  slug: string;
  title: string;
  summary: string;
  aliases: string[];
  tags: string[];
  kind: string;
  status: string;
  geographicScope: string;
  countries: string[];
  subdivisions: string[];
  city: string | null;
  online: boolean;
  trustTier: string;
  dateCertainty: string;
  provenanceUrl: string;
  sourceRevision: string;
  checkedAt: string;
  freshnessSlaHours: number;
  rightsBasis: string;
  termsUrl: string | null;
  attribution: string;
  updatedAt: string;
  followed: boolean;
  follow: EventCatalogFollow | null;
  nextOccurrence?: EventCatalogOccurrence | null;
}

export const EVENT_KIND_OPTIONS = [
  { value: "country_holidays", label: "Country holidays" },
  { value: "religious_observances", label: "Religious" },
  { value: "global_celebrations", label: "Global" },
  { value: "conference_series", label: "Conferences" },
  { value: "local_events", label: "Local events" },
] as const;

export const TRUST_TIER_OPTIONS = [
  { value: "official", label: "Official" },
  { value: "authoritative", label: "Authoritative" },
  { value: "reviewed", label: "Reviewed" },
] as const;

export interface EventCatalogResponse {
  items: EventCatalogItem[];
  nextCursor: string | null;
}

export interface EventCatalogFollowMutation {
  slug: string;
  followed: true;
  follow: EventCatalogFollow;
}

interface EventCatalogQuery {
  q?: string;
  tags?: string[];
  kind?: string;
  country?: string;
  trust?: string;
  followed?: boolean;
  limit: number;
  cursor?: string;
}

export function buildEventCatalogQuery(input: EventCatalogQuery): string {
  const params = new URLSearchParams();
  const q = input.q?.normalize("NFC").trim();
  const tags = [...new Set(
    (input.tags ?? [])
      .map((tag) => tag.normalize("NFC").trim().toLowerCase())
      .filter(Boolean)
  )];
  const kind = input.kind?.normalize("NFC").trim();
  const country = input.country?.normalize("NFC").trim().toUpperCase();
  const trust = input.trust?.normalize("NFC").trim().toLowerCase();

  if (q) params.set("q", q);
  if (tags.length) params.set("tags", tags.join(","));
  if (kind) params.set("kind", kind);
  if (country) params.set("country", country);
  if (trust) params.set("trust", trust);
  if (input.followed !== undefined) {
    params.set("followed", String(input.followed));
  }
  params.set("limit", String(input.limit));
  if (input.cursor) params.set("cursor", input.cursor);
  return params.toString();
}

export function mergeCatalogPages(
  current: EventCatalogItem[],
  incoming: EventCatalogItem[]
): EventCatalogItem[] {
  const seen = new Set(current.map((item) => item.slug));
  return [
    ...current,
    ...incoming.filter((item) => !seen.has(item.slug)),
  ];
}

export function mergeCatalogFollow(
  item: EventCatalogItem,
  mutation: EventCatalogFollowMutation
): EventCatalogItem {
  if (item.slug !== mutation.slug) return item;
  return {
    ...item,
    followed: mutation.followed,
    follow: mutation.follow,
  };
}

export function followActionLabel(item: EventCatalogItem): string {
  if (!item.followed || !item.follow) return "Follow";
  return item.follow.status === "paused" ? "Resume" : "Pause";
}

export function trustLabel(value: string): string {
  if (value === "official") return "Official";
  if (value === "authoritative") return "Authoritative";
  if (value === "reviewed") return "Reviewed";
  return sentenceLabel(value);
}

export function rightsLabel(value: string): string {
  if (value === "metadata_only") return "Factual metadata only";
  if (value === "source_terms") return "Source terms apply";
  if (value === "cc_by_4_0") return "CC BY 4.0";
  return sentenceLabel(value);
}

export function certaintyLabel(value: string): string {
  if (value === "confirmed") return "Confirmed date";
  if (value === "tentative") return "Tentative date";
  if (value === "calculated") return "Calculated date";
  return "Date status unknown";
}

export function freshnessLabel(
  checkedAt: string,
  freshnessSlaHours: number,
  now = new Date()
): string {
  const checked = new Date(checkedAt);
  const ageMs = now.getTime() - checked.getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return "Freshness unknown";
  const ageHours = Math.floor(ageMs / 3_600_000);
  if (ageHours > freshnessSlaHours) return "Review overdue";
  const days = Math.floor(ageHours / 24);
  if (days === 0) return "Checked today";
  return `Checked ${days} ${days === 1 ? "day" : "days"} ago`;
}

export function sentenceLabel(value: string): string {
  const normalized = value.replaceAll("_", " ").trim();
  return normalized
    ? normalized[0].toUpperCase() + normalized.slice(1)
    : "Unknown";
}
