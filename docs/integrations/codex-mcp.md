# Codex MCP

Create a dedicated read-only `Codex` agent client. Store the one-time credential in
an environment variable provided by the local secret manager, then add this local
configuration without the token value:

```toml
[mcp_servers.socos]
url = "https://socos.rachkovan.com/api/mcp"
bearer_token_env_var = "SOCOS_CODEX_TOKEN"
```

Restart Codex after the environment and configuration are available. Confirm that
Socos lists only the five read scopes in `docs/integrations/socos-mcp.md`. Do not
grant mutation or approval-execution scopes until there is a concrete workflow that
requires them.
