# Codex MCP

Socos includes a first-class Codex plugin at
`integrations/codex/plugins/socos`. It packages the remote MCP declaration and a
personal CRM skill with an explicit read-only safety boundary.

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

## Plugin package

The plugin reads `SOCOS_CODEX_TOKEN` through `bearer_token_env_var`; the token
must be present in the environment that launches Codex. From a clean checkout,
validate the package before adding it to the repo-local marketplace:

```bash
node scripts/validate-agent-plugin-packaging.mjs
python3 "$CODEX_PLUGIN_VALIDATOR" integrations/codex/plugins/socos
```

Install through the repo-local marketplace:

```bash
codex plugin marketplace add integrations/codex
codex plugin add socos@socos-codex
```

After installation, restart Codex and ask it to review the current Socos brief.
A read-only credential may list and read data. It must be denied if it attempts
a mutation. Do not paste a token into `.mcp.json`, plugin metadata, shell
history, or this repository.
