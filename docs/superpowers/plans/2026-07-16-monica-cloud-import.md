# Monica Cloud Import Implementation Plan

**Goal:** Import all 106 active Monica contacts into Socos exactly once per source ID while preserving labels/groups, isolating the seven existing demo contacts, and never staging personal rows outside the Coolify host.

## Task 1: Provenance And Demo Isolation

- Add Contact provenance, source timestamps, groups, and `isDemo` fields.
- Add owner-scoped source uniqueness, source-pair integrity, and demo-query indexes in a forward-only migration.
- Exclude demo contacts from due, recommendation, reminder, scoring, and analytics queries.
- Extend migration safety and query tests.

## Task 2: Validated Streaming Import

- Add a Monica exporter that emits versioned NDJSON to stdout and aggregate-only errors to stderr.
- Add a compiled Socos CLI that validates schema, exact count, and SHA-256 before opening a serializable transaction.
- Select the single production owner/vault, mark the exact seven baseline contacts as demo only on the first import, and upsert contacts by `(ownerId, sourceSystem, sourceId)`.
- Assert 106 non-demo Monica contacts and seven demo contacts before commit; report aggregate counts only.
- Delete legacy migration scripts containing unsafe logging and local real-looking fixtures.

## Task 3: Verify And Execute In Cloud

- Run focused tests, full workspace tests, typecheck, lint, build, schema comparison, and production image packaging checks.
- Take and verify a fresh production backup and encrypted offsite copy.
- Deploy migration/import CLI, then stream exporter output from Monica directly into the Socos API container with shell pipe failure propagation.
- Re-run the same import to prove idempotency and verify aggregate database invariants without returning personal rows locally.
- Run production health/auth smoke checks and record the next Daily Social Brief slice.
