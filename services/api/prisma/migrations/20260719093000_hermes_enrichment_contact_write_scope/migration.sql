-- Forward-only correction for the already-applied 20260719084500_agent_contact_write_scope
-- migration, which targeted the old active client name 'Hermes'. Production's
-- active non-revoked enrichment client is named exactly 'Hermes Enrichment'.
-- Keep revoked and differently named clients unchanged, and avoid duplicate scopes.
UPDATE "AgentClient"
SET
  "scopes" = array_append("scopes", 'contacts:write'),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Hermes Enrichment'
  AND "status" = 'active'
  AND "revokedAt" IS NULL
  AND NOT ('contacts:write' = ANY("scopes"));
