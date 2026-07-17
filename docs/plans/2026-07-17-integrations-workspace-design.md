# Socos Integrations Workspace Design

## Goal

Make the deployed Calendar, Pixel location, and event-discovery foundations
operable from the authenticated product before enabling their production
feature flags. The workspace is personal-first and optimized for a single
owner, while preserving the existing owner-scoped API contracts.

## Chosen Approach

Add `/dashboard/integrations` as one quiet operational workspace with three
independent full-width sections: Google Calendar, Pixel location, and Event
discovery. This is preferred over a Calendar-only settings page because the
three systems form one activation sequence: calendars provide plans and
conflicts, Pixel provides current context, and event sources provide candidates.
It is preferred over a new aggregate backend because all required owner-scoped
APIs already exist and each integration must be able to fail independently.

The desktop shell replaces the disabled Calendar placeholder with
`Integrations`. The mobile bottom navigation grows from three to four stable
columns and is verified at Pixel `412x915` dimensions.

## State And Data Flow

The client loads Calendar summary/sources, location devices/coarse context, and
event sources/preferences independently. `503 integration_not_configured` is a
deliberate `disabled` state; other failures remain retryable errors. No panel
may hide or invalidate another panel's successful data.

Google connect posts `{}` and navigates in the same tab to the returned OAuth
URL. Google redirects only to
`/dashboard/integrations?calendar=connected|error`; the workspace announces the
fixed result, refreshes Calendar state, and removes the query parameter.
Calendar selection uses checkboxes. Disconnect requires an explicit confirm
dialog and states that it stops sync without erasing retained context.

Pixel enrollment sends name, external device ID, and bounded retention values.
Create and rotate responses display the endpoint, username, and password in a
one-time modal. Credentials exist only in React state, are never logged or
persisted, and disappear when the modal closes or the page reloads. Rotate and
revoke require confirmation; revoke is described as stopping ingest, not
deleting history. The page displays only coarse location context, never
coordinates.

Event discovery manages certified ICS sources and preference weights. Source
responses intentionally do not reveal feed URLs after creation. The UI shows
source status, allowlisted host, polling status, city, and social weight. It can
add, enable/disable, and remove a source, plus save balanced interest tags,
distance, travel speed, and buffer. It does not claim to preview discovered
events because no such API exists; recommendations appear in the Daily Brief
only after the separate brief flag is enabled.

## Safety And Interaction

- Real data remains only in Coolify PostgreSQL. Tests use synthetic identities,
  device credentials, calendar names, locations, and feeds.
- OAuth tokens, precise coordinates, feed URLs after submission, and one-time
  credentials are never logged, stored in browser persistence, or copied into
  repository artifacts.
- Disconnect, rotate, revoke, disable, and remove actions use explicit human
  controls. The page does not add outbound messaging or agent execution paths.
- Empty `204` responses are handled explicitly by the shared API client and
  Next proxy.
- Sections use textual status in addition to color, `role="status"` for
  receipts, `role="alert"` for failures, 44px controls, focus trapping and
  restoration, Escape handling, bounded text, and no horizontal overflow.

## Verification

Vitest covers `204` parsing, feature-state mapping, and OAuth callback parsing.
Playwright covers disabled gates, Calendar connect/callback/select/disconnect,
Pixel one-time credentials/rotate/revoke, event source/preferences, partial
failures, focus behavior, and Pixel navigation/overflow. Production activation
remains staged: backup, deploy with all flags false, enable Calendar and finish
consent, enable location and enroll the Pixel, configure one certified feed and
enable discovery, then enable event briefs only after aggregate validation.

