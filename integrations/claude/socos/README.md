# Socos for Claude Code

This package adds the authenticated Socos MCP and a personal CRM safety skill to
Claude Code. It expects a dedicated read-only agent credential in
`SOCOS_CLAUDE_TOKEN`; no credential value is stored in the package.

Validate and run the source package without installing it:

```bash
node scripts/validate-agent-plugin-packaging.mjs
claude plugin validate integrations/claude/socos
```

Install it from the repository-local marketplace:

```bash
claude plugin marketplace add integrations/claude --scope user
claude plugin install socos@socos-claude --scope user
```

The plugin connects to `https://socos.rachkovan.com/api/mcp`. Claude Code
expands `SOCOS_CLAUDE_TOKEN` in the authorization header from its process
environment.

The credential must contain read scopes only. Do not grant proposal or approval
execution scopes to this plugin.
