export type PersonalDataEnvelopeDefinition = {
  model: string;
  table: string;
  name: string;
  purpose: string;
  ciphertextColumn: string;
  ivColumn: string;
  tagColumn: string;
  keyVersionColumn: string;
};

function envelope(
  model: string,
  name: string,
  purpose: string
): PersonalDataEnvelopeDefinition {
  return {
    model,
    table: model,
    name,
    purpose,
    ciphertextColumn: `${name}Ciphertext`,
    ivColumn: `${name}Iv`,
    tagColumn: `${name}Tag`,
    keyVersionColumn: `${name}KeyVersion`,
  };
}

export const PERSONAL_DATA_ENVELOPES = [
  envelope("GoogleOAuthAttempt", "pkce", "google-oauth-pkce"),
  envelope(
    "GoogleCalendarConnection",
    "refreshToken",
    "google-calendar-refresh-token"
  ),
  envelope(
    "GoogleCalendarConnection",
    "calendarListSyncToken",
    "google-calendar-list-sync-token"
  ),
  envelope("CalendarSource", "externalId", "calendar-source-external-id"),
  envelope("CalendarSource", "name", "calendar-source-name"),
  envelope("CalendarSource", "syncToken", "calendar-source-sync-token"),
  envelope("CalendarWatch", "resourceId", "calendar-watch-resource-id"),
  envelope("CalendarEvent", "externalEventId", "calendar-event-external-id"),
  envelope("CalendarEvent", "recurringEventId", "calendar-event-recurring-id"),
  envelope("CalendarEvent", "details", "calendar-event-details"),
  envelope("LocationDevice", "name", "location-device-name"),
  envelope("LocationDevice", "externalDeviceId", "location-device-external-id"),
  envelope("LocationSample", "coordinates", "location-sample-coordinates"),
  envelope("DerivedVisit", "centroid", "derived-visit-centroid"),
  envelope("LocationAlias", "alias", "location-alias"),
] as const satisfies readonly PersonalDataEnvelopeDefinition[];
