# Socos MCP

Socos exposes a stateless Streamable HTTP MCP endpoint at:

```text
https://socos.rachkovan.com/api/mcp
```

Use a distinct agent client for every integration. A human Socos session creates,
lists, rotates, and revokes clients through `/api/agent-clients`. The credential is
shown only when it is created or rotated. Store it in the client's native secret
store or an environment variable, never in this repository, command history, logs,
or a URL.

Send the credential as `Authorization: Bearer <credential>`. Agent credentials are
not human JWTs and cannot administer clients or approve proposals.

## Scope Profiles

Use these initial profiles:

| Client | Scopes |
| --- | --- |
| Hermes | `contacts:read`, `contacts:write`, `relationships:read`, `dates:read`, `reminders:read`, `briefs:read`, `enrichment:read`, `interactions:write`, `reminders:write`, `feedback:write`, `quests:complete`, `proposals:write`, `enrichment:candidates:write`, `enrichment:accept` |
| Codex | `contacts:read`, `relationships:read`, `dates:read`, `reminders:read`, `briefs:read`, `enrichment:read` |
| Claude | `contacts:read`, `relationships:read`, `dates:read`, `reminders:read`, `briefs:read`, `enrichment:read` |

Read tools do not mutate data. Interaction, reminder, feedback, and quest tools are
automatic but require a stable per-intent `idempotencyKey`. Message, introduction,
invitation, merge, and delete tools only create proposals. A human must approve the
exact payload before an execution attempt, and every grant is short-lived and
single-use. Unsupported executors fail without consuming the approval.

`socos_create_contact` requires `contacts:write`, creates one owner-scoped contact,
rejects exact case-insensitive name duplicates, and performs no outbound action. Its
strict input accepts names plus bounded labels, tags, and groups; retries must reuse
the same idempotency key.

Tool discovery is scope-aware: `tools/list` returns only tools whose required scope
is present on the authenticated client. The default Hermes profile intentionally
omits `approvals:execute`; use a separate, narrowly operated client if approved
execution is enabled in a future deployment. Direct calls remain scope-checked even
when a caller already knows a hidden tool name. Approved execution is advertised as
destructive to MCP clients; all other current tools are non-destructive.

Enrichment uses four dedicated tools and never overloads an outbound-action
approval type. `socos_contacts_missing_enrichment` and
`socos_enrichment_candidates_list` require `enrichment:read`.
`socos_enrichment_candidate_submit` requires `enrichment:candidates:write` and
stores evidence only. `socos_enrichment_candidate_accept` requires
`enrichment:accept`, refuses populated fields, and accepts only confidence `>= 0.90`
from non-public sources. Public-web evidence remains pending for authenticated human
review. See [Safe Contact Enrichment](../contact-enrichment.md).

Rotate a credential immediately after suspected disclosure. Rotation invalidates
the previous credential. Revoking a client invalidates all its credentials.

## Production Policy

The production service must set `MCP_ALLOWED_HOSTS=socos.rachkovan.com`. Set
`MCP_TRUST_PROXY=true` only behind the configured Coolify proxy. Browser-originated
clients also require an explicit `MCP_ALLOWED_ORIGINS` entry. Requests are JSON-only,
limited to 64 KiB, and bounded by `MCP_REQUEST_TIMEOUT_MS`.

Treat a transport timeout as an unknown outcome. Retry the exact same tool input
with the same idempotency key to recover the durable result; never generate a new
key merely because the HTTP response timed out.
