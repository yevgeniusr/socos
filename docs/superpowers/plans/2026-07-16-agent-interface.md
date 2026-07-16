# Authenticated Agent Interface Implementation Plan

> **Status:** Approved by the personal-first Socos design. Execute with TDD and cross-review before production deployment.

**Goal:** Give Hermes, Codex, and Claude a real authenticated Socos MCP surface with least-privilege scopes, automatic low-risk CRM actions, durable audit/idempotency, and approval-bound risky action proposals.

**Architecture:** Human JWTs administer agent clients. Agent credentials are distinct, high-entropy bearer tokens stored only as hashes. A transport-neutral tool registry owns authorization and business calls; the Streamable HTTP MCP layer is only an adapter. Reads and allowed CRM mutations execute through owner-scoped application services. Outbound messages, introductions, invitations, merges, and deletions can be proposed but never executed without a short-lived, single-use approval bound to owner, client, action, and canonical payload hash.

**Pinned dependencies:** `@modelcontextprotocol/sdk@1.29.0` (stable v1 line; create a fresh server/transport per stateless request) and `zod@4.4.3` for runtime tool schemas.

---

## Task 1: Shared Runtime Contracts

**Files:**
- Create `packages/agent-core/src/agent-interface/contracts.ts`
- Create `packages/agent-core/src/agent-interface/schemas.ts`
- Create `packages/agent-core/src/agent-interface/index.ts`
- Create `packages/agent-core/src/agent-interface/contracts.spec.ts`
- Modify `packages/agent-core/src/index.ts`
- Modify `packages/agent-core/package.json`

Define immutable scope constants, `AgentPrincipal`, risk levels, tool metadata, canonical result/error envelopes, proposal action types, and strict Zod schemas. Initial scopes:

```text
contacts:read, relationships:read, dates:read, reminders:read,
briefs:read, interactions:write, reminders:write, feedback:write,
quests:complete, proposals:write, approvals:execute
```

Reject unknown fields, owner/user/client IDs supplied by callers, client-owned rewards, and ambiguous evidence unions. Add contract tests and ensure clean-checkout type resolution works without `dist`.

## Task 2: Durable Client, Approval, Audit, And Idempotency Models

**Files:**
- Modify `services/api/prisma/schema.prisma`
- Create `services/api/prisma/migrations/20260716140000_agent_interface/migration.sql`
- Modify `scripts/migration-safety.integration.test.mjs`

Add `AgentClient`, `AgentCredential`, `AgentIdempotencyRecord`, `ActionProposal`, `ApprovalGrant`, `MutationAuditEvent`, and `ActionOutbox`. Enforce owner/client composite foreign keys, unique credential prefix, client/operation/key idempotency, proposal/grant ownership parity, status/risk/action checks, expiry indexes, and append-only audit semantics. Store only token hashes and sanitized metadata. Prove fresh and upgraded PostgreSQL paths, negative cross-owner inserts, and rerun safety.

## Task 3: Agent Credential Administration And Authentication

**Files:**
- Create `services/api/src/modules/agent-auth/*`
- Modify `services/api/src/app.module.ts`

Build human-JWT guarded endpoints to list/create/rotate/revoke agent clients. Creation and rotation return a token once in `socos_agent_<credentialId>.<secret>` form. Store SHA-256 of a 32-byte random secret, compare with `timingSafeEqual`, reject revoked/expired credentials, and update `lastUsedAt` without logging tokens. `AgentAuthGuard` attaches only a server-resolved `AgentPrincipal`; it never accepts owner or scopes from request input. Test cross-owner administration, rotation invalidation, expiry, revoked clients, malformed tokens, and response redaction.

## Task 4: Canonical Idempotency, Audit, Proposals, And Approval Grants

**Files:**
- Create `services/api/src/modules/agent-security/*`

Implement deterministic JSON canonicalization and hashing, generic client/operation idempotency in serializable transactions, append-only sanitized audits, action proposal creation, human approve/reject endpoints, and single-use approval validation. Approval grants bind `ownerId`, `clientId`, `proposalId`, `actionType`, `payloadHash`, and expiry. A wrong client, changed payload, replay, rejection, revocation, or expiry fails closed. Never put contact text, message bodies, tokens, or raw provider responses in audit metadata.

## Task 5: Make Automatic CRM Commands Atomic

**Files:**
- Modify `services/api/src/modules/interactions/interactions.service.ts`
- Modify `services/api/src/modules/reminders/reminders.service.ts`
- Modify relevant specs

Move interaction creation, contact activity, XP/achievement changes, and audit linkage into one transaction with exactly-once evidence. Separate reminder persistence from external notification sending so an agent-created reminder cannot send implicitly. Keep human REST behavior compatible. Add rollback, concurrent retry, demo exclusion, and no-notification tests.

## Task 6: Explicit Tool Registry

**Files:**
- Replace `services/api/src/modules/agent-tools/agent-tools.module.ts`
- Create `services/api/src/modules/agent-tools/tool-registry.service.ts`
- Create `services/api/src/modules/agent-tools/tool-handlers.ts`
- Create focused specs

Register tools with name, description, runtime input schema, required scope, risk, idempotency requirement, and handler. Initial tools:

```text
socos_brief_today
socos_contacts_search
socos_relationship_health
socos_important_dates
socos_reminders_list
socos_log_interaction
socos_create_reminder
socos_brief_feedback
socos_complete_quest
socos_propose_action
```

All handlers use `principal.ownerId`, return least-privilege presenters, and call application services rather than Prisma. `socos_propose_action` supports message, introduction, invitation, merge, and delete previews but performs no risky side effect. Unknown tools/actions fail closed with stable public codes.

## Task 7: Streamable HTTP MCP Transport

**Files:**
- Create `services/api/src/modules/mcp/mcp.controller.ts`
- Create `services/api/src/modules/mcp/mcp-server.factory.ts`
- Create `services/api/src/modules/mcp/mcp.module.ts`
- Create protocol specs
- Modify `services/api/src/app.module.ts`
- Modify `services/api/package.json`

Expose `POST /api/mcp` using stateless JSON-response Streamable HTTP. Authenticate before protocol handling. Create a fresh `McpServer` and `StreamableHTTPServerTransport` per request; never reuse transport/server instances across clients. Enforce request-size, method, Origin/Host, timeout, and content-type limits. Test initialize, tools/list, tools/call, bearer failures, scope matrix, unknown input, cross-owner isolation, parallel clients, and sanitized errors against the official SDK client.

## Task 8: Approval Execution Boundary

**Files:**
- Extend agent security/tool registry modules and specs

Add `socos_execute_approved_action`. It consumes a bound approval once inside the same transaction that creates an outbox record. Only explicitly implemented action executors may run. Until message/introduction/invitation/merge/delete domain executors exist, return `ACTION_EXECUTION_UNAVAILABLE` without consuming the grant. Prove wrong payload/client, replay, expiry, and unsupported actions leave state unchanged. No provider sender is added in this slice.

## Task 9: Client Guides And Local Hermes Configuration

**Files:**
- Create `docs/integrations/socos-mcp.md`
- Create `docs/integrations/hermes-mcp.md`
- Create `docs/integrations/codex-mcp.md`
- Create `docs/integrations/claude-mcp.md`
- Create a standalone Hermes plugin under `~/.hermes/plugins/socos/` only if the MCP client cannot supply headers/scheduling itself

Document distinct credentials, scopes, rotation, revocation, environment/native-secret storage, and approval behavior. Configure Hermes to use the remote MCP endpoint and add a daily Discord cron job that fetches `socos_brief_today`; it posts nothing for `BRIEF_NOT_READY`. Replies map to feedback/quest tools with stable per-intent idempotency keys. Start Codex and Claude read-only. Never write tokens to the repository or shell history.

## Task 10: PostgreSQL, Protocol, Security, And Deployment Gate

**Files:**
- Create `services/api/test/agent-interface.integration.spec.ts`
- Create `scripts/run-agent-interface-integration.mjs`
- Modify root scripts/security regression tests
- Create `docs/validation/agent-interface-v1.md`

On a disposable `_test` PostgreSQL database prove concurrent idempotency, owner isolation, credential rotation/revocation, approval binding/replay/expiry, audit redaction, outbox exactly-once, and unsupported execution non-consumption. Security scans must reject unguarded MCP/admin routes, caller-supplied ownership/scopes/rewards, raw token logging, and direct risky handlers.

Run:

```bash
pnpm test
AGENT_TEST_DATABASE_URL="$DISPOSABLE_TEST_DATABASE_URL" pnpm test:agent-interface-integration
pnpm type:check
pnpm build
pnpm lint
node scripts/security-regression.mjs
git diff --check
```

Then take a verified Coolify and encrypted offsite backup, deploy the forward-only migration, issue distinct production clients through the human admin API, verify MCP initialize/list/read with aggregate-only output, configure Hermes, and take a post-deploy backup. Record commit, CI/deployment IDs, migration count, aggregate audit/client counts, tests, and rollback procedure without credentials or personal rows.

## Completion Gate

- Human and agent authentication remain distinct.
- Every tool has strict runtime validation, required scope, owner isolation, risk class, and stable errors.
- Automatic mutations are transactional, idempotent, audited, and free of implicit outbound effects.
- Risky actions require a payload-bound single-use human approval and unsupported executors fail without consuming it.
- MCP uses the official stable SDK with a fresh server/transport per stateless request.
- Hermes reads the real cloud brief and records replies through authenticated tools; Codex and Claude have separate read-only clients.
- Real PostgreSQL/protocol/security tests and production backup/deployment smoke gates pass.
