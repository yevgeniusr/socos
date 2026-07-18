export type LoadableIntegration<T> =
  | { status: "loading" }
  | { status: "disabled" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

export interface CalendarConnectResponse {
  authorizationUrl: string;
}

export interface CalendarConnectionResponse {
  id: string;
  status: string;
  grantedScopes: string[];
  lastSyncedAt: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CalendarConnectionsResponse = CalendarConnectionResponse[];

export interface CalendarSourceResponse {
  id: string;
  name: string;
  timeZone: string | null;
  selected: boolean;
  isPrimary: boolean;
  fullSyncRequired: boolean;
  lastSyncedAt: string | null;
  errorCode: string | null;
}

export type CalendarSourcesResponse = CalendarSourceResponse[];

export interface LocationDeviceResponse {
  id: string;
  name: string;
  externalDeviceId: string;
  status: string;
  rawRetentionDays: number;
  derivedRetentionDays: number;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type LocationDevicesResponse = LocationDeviceResponse[];

export interface LocationContextResponse {
  source: "sample" | "visit" | "calendar" | "fallback";
  city: string | null;
  countryCode: string | null;
  timeZone: string | null;
  distanceCapability: boolean;
  lastSeenAt: string | null;
}

export interface EventSourceResponse {
  id: string;
  name: string;
  provider: string;
  allowedHost: string;
  city: string | null;
  countryCode: string | null;
  socialWeight: number;
  status: string;
  pollIntervalMinutes: number;
  nextPollAt: string;
  lastPolledAt: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export type EventSourcesResponse = EventSourceResponse[];

export type EventPreferenceResponse = {
  id: string;
  interestTags: string[];
  maxDistanceKm: number;
  travelSpeedKph: number;
  travelBufferMinutes: number;
  createdAt: string;
  updatedAt: string;
} | null;
