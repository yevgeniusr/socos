export const EVENT_FEED_URL_PURPOSE = "event-source-feed-url";
export const EVENT_PROVIDER_ID_PURPOSE = "discovered-event-provider-event-id";
export const EVENT_CANONICAL_PURPOSE = "canonical-event";

export type CertifiedFeedUrl = {
  href: string;
  hostname: string;
};

export type EventSourceInput = {
  name: string;
  feedUrl: string;
  city?: string | null;
  countryCode?: string | null;
  socialWeight?: number;
  pollIntervalMinutes?: number;
};

export type EventSourcePatch = {
  name?: string;
  feedUrl?: string;
  city?: string | null;
  countryCode?: string | null;
  socialWeight?: number;
  pollIntervalMinutes?: number;
  status?: "active" | "disabled";
};

export type EventPreferenceInput = {
  interestTags: string[];
  maxDistanceKm?: number;
  travelSpeedKph?: number;
  travelBufferMinutes?: number;
};

export type NormalizedDiscoveredEvent = {
  providerEventId: string;
  canonicalIdentity: string;
  title: string;
  descriptionExcerpt: string | null;
  url: string | null;
  startAt: Date;
  endAt: Date;
  timeZone: string | null;
  venueName: string | null;
  address: string | null;
  city: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  tags: string[];
  status: "scheduled" | "cancelled";
  sourceUpdatedAt: Date | null;
  expiresAt: Date;
};
