# Agent Interface V1 Validation

Validated on 2026-07-16 against production at
`https://socos.rachkovan.com` without copying personal rows or credentials into
the workspace.

## Release Identity

- Git commit: `72ddf7d4d72bdfebc609378fe98863001092c292`
- GitHub Actions run: [`29467974938`](https://github.com/yevgeniusr/socos/actions/runs/29467974938), `success`
- Coolify deployment: `t121ux2c11hcnde33tal19sy`, `finished`
- Running API and web image tags match the full Git commit.
- Pre-deploy Coolify backup: `oksvsnku2eoklq96n5cnny2f`, `success`
- Post-deploy Coolify backup: `lyfmem6e6qdz8lvjemf7zaax`, `success`
- Post-deploy encrypted off-host verification: zero differences across seven
  matching retained files, with 30-day retention.

## Production Evidence

- Prisma reports seven applied migrations and no pending migration.
- The database contains 106 non-demo Monica contacts and seven isolated demo
  contacts.
- Three distinct active agent clients and three active credentials exist for
  Hermes, Codex, and Claude. Every credential has completed an authenticated
  request.
- The MCP server exposes 11 tools. All three clients completed initialize,
  tool-list, and daily-brief reads through the official MCP SDK.
- A read-only client was denied a mutation as expected.
- One aggregate mutation audit event exists after the protocol smoke test. No
  request payload or personal row was inspected for this validation.
- Unauthenticated health checks return `200`; protected REST and MCP routes
  return `401` without credentials.

## Client Delivery

- Hermes has the Socos HTTP MCP enabled with its token held outside its YAML
  configuration.
- Hermes daily job `59db0ea1d9d8` runs at `09:00 Asia/Dubai`, targets the
  existing Discord delivery channel, and its manual production run completed
  with `last_status=ok` and no delivery error.
- Codex uses `SOCOS_CODEX_TOKEN` through `bearer_token_env_var`.
- Claude uses an environment-expanded authorization header referencing
  `SOCOS_CLAUDE_TOKEN`.
- Both local variables are loaded from macOS Keychain by a user LaunchAgent;
  plaintext bearer tokens are absent from the Codex and Claude MCP
  configuration files.

## Verification

The successful CI run covered lint, type checking, unit tests, the daily-brief
PostgreSQL integration suite, the agent-interface PostgreSQL integration suite,
builds, and production image startup. The focused deployment and backup test
suite also passed 32 of 32 tests, `git diff --check` passed, and the security
regression scan passed across 383 tracked files.

Production smoke checks confirmed:

```text
migrations=7 pending=0
contacts_real=106 contacts_demo=7
agent_clients=3 active_clients=3 credentials=3 credentials_used=3
mutation_audits=1
mcp_clients=3 mcp_tools=11 brief_reads=3 readonly_write_denied=true
post_deploy_backup=success offsite_differences=0
```

## Rollback

This release uses a forward-only additive migration. If application behavior
regresses, disable agent access by revoking the affected clients, then redeploy
the prior known-good application image without rolling the database schema
back. The agent tables may remain unused. Restore is reserved for data-loss or
database-corruption recovery and must use the verified pre-deploy or
post-deploy backup in a disposable environment before any production restore.
Keep the encrypted off-host generations until their retention window expires.

Risky outbound actions remain approval-gated throughout rollback. Do not issue
mutation scopes to Codex or Claude merely to work around an unavailable agent
path.
