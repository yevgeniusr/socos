# Claude MCP

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
