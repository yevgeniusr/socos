# Hermes MCP

Create a dedicated `Hermes` agent client with the Hermes scope profile from
`socos-mcp.md`. Add the remote server interactively so the bearer credential is not
placed in shell history:

```bash
hermes mcp add socos --url https://socos.rachkovan.com/api/mcp --auth header
hermes mcp test socos
```

Use Hermes's credential prompt or configured secret provider for the
`Authorization` header. Do not put the token directly in `config.yaml`.

The daily Discord job calls `socos_brief_today`. It posts nothing when Socos returns
`BRIEF_NOT_READY`. Discord replies map to `socos_brief_feedback` and
`socos_complete_quest`; retries reuse the same per-intent idempotency key. Logging an
interaction or creating a reminder is allowed automatically. Outbound messages,
introductions, invitations, merges, and deletions must stop after
`socos_propose_action` until a human approves the proposal in Socos.

When the owner explicitly asks Hermes to save a person, `socos_create_contact` may
create the owner-scoped CRM record with a stable idempotency key. Hermes must search
first, avoid exact duplicates, and preserve source classification through bounded
labels or tags without inventing names, roles, dates, or relationship facts.

For explicitly requested enrichment work, Hermes may page through
`socos_contacts_missing_enrichment`, inspect candidates with
`socos_enrichment_candidates_list`, and submit provenance-backed rows with
`socos_enrichment_candidate_submit`. It may call
`socos_enrichment_candidate_accept` only for confidence `>= 0.90` non-public
evidence and must treat conflicts as a stop condition. Public-web evidence always
stays pending; conversational approval is not enough to bypass that boundary. These
tools do not send anything externally and do not require `approvals:execute`.

Keep scheduled output aggregate-only. Never include raw credentials, authorization
headers, full contact exports, or precise location samples in cron output.
