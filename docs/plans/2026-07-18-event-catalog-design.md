# Event Catalog Marketplace Design

## Goal

Build a searchable marketplace of trustworthy calendars that Socos can follow
for holidays, religious observances, conferences, global celebrations, and
local social events. Reuse the existing owner-scoped event ingestion, ranking,
Calendar-conflict, feedback, and Daily Brief pipeline.

## Decision

There is no single source with sufficient breadth, licensing, freshness, and
authority. Socos will own catalog metadata and combine curated authoritative
sources with reviewed external feeds. Catalog metadata is global; follows,
preferences, discovered events, and feedback remain owner-scoped.

The first release layers a catalog over the existing certified ICS adapter.
Later provider adapters may ingest strict JSON APIs without changing the public
catalog or follow model. Arbitrary user submissions never become fetchable
until their host and connector are reviewed.

## Data Model

`EventCatalogListing` stores:

- stable slug, title, original summary, aliases, tags, kind, and status;
- geographic scope, countries, subdivisions, city, and online flag;
- trust tier, date certainty, provenance URL, source revision, checked time,
  freshness SLA, license, and attribution;
- connector type and an encrypted or server-controlled connector reference;
- content hash and timestamps.

`EventCatalogFollow` stores one owner/listing pair, linked owner-scoped
`EventSource`, active or paused state, social weight, and timestamps.

`EventCatalogImportRun` stores fixed safe outcomes, upstream validators,
content hash, counts, and timing. Raw provider payloads and token-bearing URLs
must never enter logs or audit metadata.

`DiscoveredEvent` gains provenance revision, checked time, all-day state, and
`confirmed | tentative | calculated` date certainty.

## API And Agent Contract

- `GET /event-catalog`: normalized search with `q`, `tags`, `kind`, country,
  city, trust, followed state, and stable cursor pagination.
- `GET /event-catalog/:slug`: listing, attribution, freshness, next occurrence,
  and owner follow state.
- `PUT /event-catalog/:slug/follow`: idempotent follow that creates exactly one
  owner-scoped source from a reviewed connector.
- `PATCH /event-catalog/:slug/follow`: pause or resume without deleting history.
- `POST /event-catalog/submissions`: quarantine a suggestion for review; it
  cannot create a fetchable source.

MCP adds search, listing, and followed-list reads. A follow remains an audited
proposal for general agents; no catalog action may send invitations or messages.

## Search And UX

Use PostgreSQL full-text search for title, summary, and aliases, plus GIN tag
indexes. Rank by text match, current location, official trust, freshness, then
stable slug. Add `/dashboard/discover` with `Recommended`, `Following`, and
`All` tabs; search; tag/type/country/city/trust filters; dense result rows;
provenance; certainty; freshness; next occurrence; and Follow/Pause controls.
Keep raw custom ICS under Integrations as an advanced workflow.

## Initial Catalog

1. UAE public holidays from the UAE Government, with Islamic dates tentative
   until official moon-sighting confirmation.
2. UN International Days and Weeks, storing facts and source links rather than
   copied descriptions.
3. Jewish holidays for Diaspora and Israel through Hebcal with CC BY 4.0
   attribution and rate limiting.
4. GITEX Global, AI Everything, and selected DWTC technology/business series
   sourced from official pages.
5. Re-certified Dubai AI/startup Meetup feeds if their ICS endpoints remain
   public and stable.
6. OpenHolidays countries only after an explicit ODbL storage and attribution
   decision; do not use Nager.Date commercially without an agreement.

The legacy Celebration seed is excluded from authoritative results because it
hardcodes movable dates and conflates unrelated lunar calendar systems.

## Delivery Slices

1. Add migration, constraints, indexes, catalog/follow services, owner isolation,
   deterministic seed manifests, and search/follow API tests.
2. Add the Discover workspace, responsive filters, listing details, follow/pause,
   provenance, freshness, and browser coverage at desktop and Pixel 412x915.
3. Add provider importers with DNS pinning, no redirects, size/deadline caps,
   schema quarantine, ETag/hash caching, correction revisions, and safe errors.
4. Add read-only MCP discovery and audited follow proposals.
5. Run migration safety, focused API/web/browser suites, independent security
   review, exact-SHA cloud restore gate, deployment, and aggregate production
   verification before enabling event discovery.

## Acceptance

- Search, tags, filters, pagination, and follow state are deterministic and
  owner-isolated.
- Following is idempotent and cannot duplicate a source or occurrence.
- Every active listing has provenance, license/attribution, trust, freshness,
  and date certainty.
- Tentative-to-confirmed corrections preserve source revision history.
- SSRF, redirect, DNS rebinding, oversized payload, schema drift, and secret
  redaction regressions pass.
- Catalog events continue to obey travel, Calendar-conflict, feedback, and
  three-item Daily Brief limits.
