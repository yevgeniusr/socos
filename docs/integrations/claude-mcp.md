# Claude MCP

Socos includes a first-class Claude Code plugin at
`integrations/claude/socos`. It packages the remote MCP declaration and a
personal CRM skill with an explicit read-only safety boundary.

Create a dedicated read-only `Claude` agent client with the five read scopes in
`docs/integrations/socos-mcp.md`. Configure the remote HTTP endpoint at:

```text
https://socos.rachkovan.com/api/mcp
```

Claude Code supports remote HTTP MCP headers. Add the server through its user-scope
configuration and use a secret-backed `Authorization: Bearer ...` header. Avoid
placing the credential directly on a command line because that can persist in shell
history. Verify with `claude mcp list`, then rotate the credential if it appeared in
terminal output, configuration committed to a repository, or a diagnostic bundle.

Keep this client read-only. Human approval remains in Socos; Claude must not receive
`proposals:write` or `approvals:execute` by default.

## Plugin package

The plugin expands `SOCOS_CLAUDE_TOKEN` from the environment that launches
Claude Code. From a clean checkout, validate the source package and repo-local
marketplace with:

```bash
node scripts/validate-agent-plugin-packaging.mjs
claude plugin validate integrations/claude/socos
```

Install through the repo-local marketplace:

```bash
claude plugin marketplace add integrations/claude --scope user
claude plugin install socos@socos-claude --scope user
```

Confirm with `claude mcp list`, and ask Claude to review the current Socos
brief. A read-only credential must be denied if it attempts a mutation. Do not
paste a token into `.mcp.json`, plugin metadata, shell history, or this
repository.
