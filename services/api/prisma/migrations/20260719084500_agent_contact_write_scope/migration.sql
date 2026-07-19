-- Grant the documented Hermes profile access to the owner-scoped contact-creation tool.
-- Existing clients keep their credentials; revoked and differently named clients are untouched.
UPDATE "AgentClient"
SET
  "scopes" = array_append("scopes", 'contacts:write'),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Hermes'
  AND "status" = 'active'
  AND "revokedAt" IS NULL
  AND NOT ('contacts:write' = ANY("scopes"));
