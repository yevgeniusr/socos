# Personal-First Socos Design

**Date:** 2026-07-15  
**Status:** Validated  
**Primary user:** Yev  
**Deployment:** Coolify, with cloud PostgreSQL as the sole source of truth

## Objective

Turn Socos into a useful personal CRM within days, then generalize the proven workflow for public users. Socos should help maintain relationships, remember personal context, track important dates and commitments, recommend nearby events and introductions, organize celebrations and social adventures, and make meaningful social action easier through gamification.

The first success criterion is behavioral: on most days Socos should surface at least one relevant action that the user accepts, completes, snoozes, or explicitly rejects. Feedback must improve future recommendations rather than cause mechanical repetition.

## Product Workflow

The primary interface is a daily Discord **Social Brief** delivered through the user's local Hermes agent. The web application remains the detailed workspace.

Each brief contains a small ranked set:

- **People:** two or three connections worth contacting, with context, health, last interaction, and a reason.
- **Dates:** birthdays, anniversaries, celebrations, promised follow-ups, and reminders.
- **Events:** nearby options compatible with location, calendar, interests, and available time.
- **Introductions:** pairs of contacts who may benefit from meeting, with evidence and a draft introduction.
- **Quests:** two to four achievable social actions selected from the above.

Relationship health considers importance, preferred cadence, recent interactions, unfinished commitments, important dates, location overlap, and dismissed suggestions. Health objectives generate daily quests. Meaningful completion awards XP, while achievements, themed challenges, streaks, weekly reflections, and longer campaigns provide RPG progression.

## Cloud Data Architecture

Coolify PostgreSQL remains the only source of truth for personal data. Local development may use authenticated APIs or a controlled database tunnel, but real contacts, location history, calendar context, and interactions must not be copied into local fixtures or committed files. A tested backup and restore path is required before migration.

Import all 106 Monica contacts with stable source identifiers and provenance. Preserve labels and groups. Mark the seven current contacts as demo data and exclude them from briefs, scoring, and analytics. Imports must be idempotent.

The model distinguishes:

- People, identities, contact methods, labels, relationship types, importance, cadence, and health.
- Structured facts and free-form memories with source, confidence, timestamps, and review state.
- Interactions, commitments, reminders, important dates, celebrations, introductions, and attendance.
- Calendar items, plans, device locations, inferred stays, and nearby places.
- Recommendations with evidence, score, delivery state, feedback, and resulting action.
- Quests, XP transactions, streaks, achievements, campaigns, and reflections.
- Agent clients, scopes, approvals, audit events, and idempotency keys.

Precise Pixel location samples are stored with device identity and accuracy metadata. Derived visits and city stays are separate records. Retention remains configurable.

## Integrations And Data Flow

Google Calendar connects directly through OAuth with read-only access initially. It supplies availability, travel, attendance, and planned-city context. Calendar writes remain approval-gated.

The Pixel sends background location to a device-specific authenticated HTTPS endpoint using an OwnTracks-compatible payload initially. A dedicated companion application can follow. Location processing derives stays and nearby context. When data is stale or absent, Socos falls back to calendar city and then the Dubai home base.

Event ingestion uses replaceable adapters for public event platforms, venue and community calendars, and calendar-discovered events. Ranking considers time, travel distance, conflicts, interests, social value, contact overlap, novelty, and feedback. Every suggestion records why it was selected.

A scheduled cloud job stores a durable Social Brief recommendation batch. Hermes fetches it through the Socos MCP/API client, posts it to Discord, and returns replies as structured feedback or actions. Delivery and mutations are idempotent.

## MCP And Permissions

The MCP server uses the same application service layer as the REST API. Initial tools cover contact search and context, relationship health, interaction logging, reminders, important dates, recommendations, brief retrieval, feedback, quest completion, and action proposals.

Risk-based autonomy is enforced server-side:

- Hermes may read, summarize, log interactions, update activity, create reminders, capture facts, and record feedback automatically.
- Outbound messages, introductions, invitations, merges, and deletions require an explicit approval token.

Each client receives granular scopes. Every mutation records the client, actor, input summary, result, and related entity. Action proposals have previews and expiry. Retryable provider work uses bounded backoff; individual provider failures degrade confidence rather than block the whole brief.

Before importing personal data, remove the existing hardcoded authentication bypass, unauthenticated database mutation path, spoofable user identity header, and unrestricted notification routes. Rotate exposed secrets and disable or administrator-scope production debugging routes.

## Delivery Slices

1. **Stabilize and import:** repair CI and dependency locking, close authentication risks, align production routes, configure backups, add provenance, import Monica contacts, and isolate demo data.
2. **Daily relationship loop:** ship relationship health, important dates, recommendation batches, daily quests, and the first Hermes-readable brief.
3. **Agent interface:** ship authenticated MCP tools, scopes, approvals, auditing, and Discord-oriented responses; document Hermes, Claude, and Codex setup.
4. **Context and discovery:** connect Calendar, deploy Pixel ingestion, derive stays, add event adapters, and introduce event and introduction recommendations.
5. **Progression and refinement:** combine relationship health, quests, streaks, achievements, campaigns, reflections, and preference learning.

## Verification

Engineering tests cover scoring rules, authorization boundaries, import idempotency, duplicate delivery, timezone behavior, recurring dates, and XP integrity. Integration tests use synthetic data. Production smoke tests are read-only except for explicitly tagged test records. Deployments require passing builds, migrations, API checks, and a rollback-ready backup.

Success metrics include brief delivery, recommendation response rate, meaningful actions completed, stale-contact reduction, false-positive feedback, and weekly return behavior.

## GPT-5.5 Betabot Society

A research-weighted cohort of 24 synthetic personas runs in waves of eight. Personas derive from recurring second-brain evidence such as entrepreneurial workload, uneven social energy, networking goals, travel context, interest in AI, open source, education, and gamification, skepticism toward administrative overhead, and preference for agent-driven workflows. Traits vary deliberately; bots are not identical copies.

Each bot uses the pinned `gpt-5.5-2026-04-23` model snapshot. Product-quality sessions use real browsers, a real staging backend, dedicated Discord test channels through Hermes, multiple human-paced visits, and synthetic contacts, calendars, locations, and conversations. Bots may not inspect source code, databases, logs, or hidden requirements.

Each wave preserves screenshots and first-person raw journeys. Repeated or severe findings drive changes, followed by a fresh cohort. Unhappy stories remain visible.

The release gate is:

- Aggregate happiness of at least 70.
- No unresolved critical defects.
- At least 90 percent completion for applicable core journeys.
- No high-confidence trust or usability blockers.
- Every high-confidence complaint is fixed or documented as an intentional product tradeoff.

Betabots validate human experience. Engineering tests remain authoritative for API, MCP, migration, permission, and data-integrity behavior.
