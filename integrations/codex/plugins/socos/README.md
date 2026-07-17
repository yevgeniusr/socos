# Socos for Codex

This package adds the authenticated Socos MCP and a personal CRM safety skill to
Codex. It expects a dedicated read-only agent credential in
`SOCOS_CODEX_TOKEN`; no credential value is stored in the package.

Validate the source package before cataloging or installing it:

```bash
node scripts/validate-agent-plugin-packaging.mjs
python3 "$CODEX_PLUGIN_VALIDATOR" integrations/codex/plugins/socos
```

Install it from the repository-local marketplace, then restart Codex:

```bash
codex plugin marketplace add integrations/codex
codex plugin add socos@socos-codex
```

The plugin's MCP declaration connects to
`https://socos.rachkovan.com/api/mcp` and reads the token from the environment
of the Codex process.

The credential must contain read scopes only. Do not grant proposal or approval
execution scopes to this plugin.
