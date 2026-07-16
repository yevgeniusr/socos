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

Keep scheduled output aggregate-only. Never include raw credentials, authorization
headers, full contact exports, or precise location samples in cron output.
