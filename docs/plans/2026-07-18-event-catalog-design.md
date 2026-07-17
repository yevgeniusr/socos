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

The first release adds catalog browsing and source-free owner follows. A follow
records interest immediately; it does not fabricate an ICS source or enable
network ingestion. Later reviewed provider adapters attach a source and ingest
strict ICS or JSON without changing the public catalog or follow model.
Arbitrary user submissions never become fetchable until their host and
connector are reviewed.

## Data Model

`EventCatalogListing` stores:

- stable slug, title, original summary, aliases, tags, kind, and status;
- geographic scope, countries, subdivisions, city, and online flag;
- trust tier, date certainty, provenance URL, source revision, checked time,
  freshness SLA, explicit rights basis, optional terms URL, and attribution;
- connector type and an encrypted or server-controlled connector reference;
- content hash and timestamps.

`EventCatalogFollow` stores one owner/listing pair, an optional linked
owner-scoped `EventSource`, active or paused state, social weight, and
timestamps. The source remains null until a reviewed importer exists.

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
- `PUT /event-catalog/:slug/follow`: idempotently saves or resumes one
  owner-scoped follow without starting ingestion.
- `PATCH /event-catalog/:slug/follow`: pause or resume without deleting history.
- `POST /event-catalog/submissions`: quarantine a suggestion for review; it
  cannot create a fetchable source.

MCP adds search, listing, and followed-list reads. A follow remains an audited
proposal for general agents; no catalog action may send invitations or messages.

## Search And UX

The initial bounded catalog uses normalized case-insensitive title/summary
search, exact normalized aliases, GIN tag/country indexes, and stable slug
pagination. Move to indexed full-text or trigram search before the catalog is
large enough for substring scans to matter. `/dashboard/discover` ships with
`All` and `Following` tabs; search; tag/type/country/trust filters; dense result
rows; provenance; rights; certainty; freshness; and Follow/Pause controls.
Location-ranked `Recommended`, city/online filters, and next-occurrence data
arrive with importers. Raw custom ICS remains under Integrations.

## Initial Catalog

1. UAE public holidays from the UAE Government, with Islamic dates tentative
   until official moon-sighting confirmation.
2. UN International Days and Weeks, storing facts and source links rather than
   copied descriptions.
3. Jewish holidays for Diaspora and Israel through Hebcal with CC BY 4.0
   attribution and rate limiting.
4. GITEX Global and AI Everything sourced from official pages.
5. Re-certified Dubai AI/startup Meetup feeds if their ICS endpoints remain
   public and stable.
6. OpenHolidays countries only after an explicit ODbL storage and attribution
   decision; do not use Nager.Date commercially without an agreement.

The legacy Celebration seed is excluded from authoritative results because it
hardcodes movable dates and conflates unrelated lunar calendar systems.

## Delivery Slices

1. **Implemented:** migration, constraints, catalog/follow services, owner
   isolation, six deterministic seed listings, search/filter/detail APIs, and
   source-free follow/pause mutations.
2. **Implemented:** responsive Discover workspace, listing details,
   provenance/rights/freshness/certainty, filters, pagination, and follow/pause.
   Unit, type, lint, and production-build checks pass; live browser screenshots
   remain pending because the local Playwright CLI wrapper is unavailable.
3. **Remaining:** provider importers with DNS pinning, no redirects, size/deadline caps,
   schema quarantine, ETag/hash caching, correction revisions, and safe errors.
4. **Remaining:** location-ranked recommendations, longer occurrence previews,
   source attachment, and Today/Daily Brief delivery from followed listings.
5. **Remaining:** read-only MCP discovery and audited follow proposals.
6. Run migration safety, focused API/web/browser suites, independent security
   review, exact-SHA cloud restore gate, deployment, and aggregate production
   verification before enabling event discovery.

## Acceptance

- Search, tags, filters, pagination, and follow state are deterministic and
  owner-isolated.
- Following is idempotent and cannot duplicate an owner/listing preference.
- Every active listing has provenance, explicit rights basis/attribution, trust, freshness,
  and date certainty.
- Tentative-to-confirmed corrections preserve source revision history.
- SSRF, redirect, DNS rebinding, oversized payload, schema drift, and secret
  redaction regressions pass.
- Catalog events continue to obey travel, Calendar-conflict, feedback, and
  three-item Daily Brief limits.
