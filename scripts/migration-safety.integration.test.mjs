import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const databaseUrl = process.env.TEST_DATABASE_URL;
const migrationPaths = [
  "services/api/prisma/migrations/20260327000000_initial_schema/migration.sql",
  "services/api/prisma/migrations/20260331000000_add_celebrations/migration.sql",
];
const reconciliationPath = resolve(
  root,
  "services/api/prisma/migrations/20260715000000_reconcile_production_schema/migration.sql",
);
const preBriefMigrationPaths = [
  "services/api/prisma/migrations/20260715000000_reconcile_production_schema/migration.sql",
  "services/api/prisma/migrations/20260716000000_persist_dm_debrief/migration.sql",
  "services/api/prisma/migrations/20260716120000_add_contact_provenance/migration.sql",
];
const dailyBriefMigrationPath = resolve(
  root,
  "services/api/prisma/migrations/20260716130000_daily_social_brief/migration.sql",
);
const agentInterfaceMigrationPath = resolve(
  root,
  "services/api/prisma/migrations/20260716140000_agent_interface/migration.sql",
);
const calendarLocationMigrationPath = resolve(
  root,
  "services/api/prisma/migrations/20260716150000_calendar_location/migration.sql",
);
const expectedBriefTables = [
  "BriefBatch",
  "BriefItem",
  "Quest",
  "BriefFeedback",
  "XpTransaction",
];
const expectedUniqueIndexes = [
  "BriefBatch_ownerId_localDate_key",
  "BriefFeedback_ownerId_idempotencyKey_key",
  "XpTransaction_ownerId_sourceType_sourceId_key",
];
const expectedChecks = [
  ["User_briefHourLocal_check", /briefHourLocal >= 0.+briefHourLocal <= 23/],
  ["Contact_importance_check", /importance >= 1.+importance <= 5/],
  [
    "Contact_preferredCadenceDays_check",
    /preferredCadenceDays >= 7.+preferredCadenceDays <= 365/,
  ],
  ["Quest_xpReward_check", /xpReward.*>= 0/],
  ["BriefFeedback_target_check", /num_nonnulls\(briefItemId, questId\) = 1/],
];
const expectedAgentTables = [
  "AgentClient",
  "AgentCredential",
  "AgentIdempotencyRecord",
  "ActionProposal",
  "ApprovalGrant",
  "MutationAuditEvent",
  "ActionOutbox",
];
const expectedAgentUniqueIndexes = [
  "AgentClient_id_ownerId_key",
  "AgentCredential_tokenPrefix_key",
  "AgentIdempotencyRecord_clientId_operation_idempotencyKey_key",
  "ActionProposal_id_ownerId_clientId_key",
  "ApprovalGrant_proposalId_key",
  "ApprovalGrant_id_ownerId_clientId_key",
  "ApprovalGrant_proposalId_ownerId_clientId_key",
  "ActionOutbox_grantId_key",
  "ActionOutbox_grantId_ownerId_clientId_key",
];
const expectedAgentExpiryIndexes = [
  "AgentCredential_expiresAt_idx",
  "AgentIdempotencyRecord_expiresAt_idx",
  "ActionProposal_expiresAt_idx",
  "ApprovalGrant_expiresAt_idx",
];
const expectedAgentChecks = [
  ["AgentClient_status_check", /status.*active.*revoked/],
  ["AgentCredential_tokenHash_check", /char_length\(tokenHash\) = 64/],
  [
    "AgentIdempotencyRecord_status_check",
    /status.*in_progress.*completed.*failed/,
  ],
  [
    "ActionProposal_status_check",
    /status.*pending.*approved.*rejected.*expired.*cancelled/,
  ],
  ["ActionProposal_riskLevel_check", /riskLevel = 'approval_required'/],
  [
    "ActionProposal_actionType_check",
    /actionType.*message.*introduction.*invitation.*merge.*delete/,
  ],
  ["ApprovalGrant_status_check", /status.*active.*consumed.*revoked.*expired/],
  ["MutationAuditEvent_outcome_check", /outcome.*succeeded.*rejected.*failed/],
  [
    "ActionOutbox_status_check",
    /status.*pending.*processing.*completed.*failed.*cancelled/,
  ],
  ["ActionOutbox_attempts_check", /attempts >= 0/],
];
const expectedAgentForeignKeys = [
  [
    "AgentCredential_clientId_ownerId_fkey",
    /FOREIGN KEY \(clientId, ownerId\).*AgentClient\(id, ownerId\)/,
  ],
  [
    "AgentIdempotencyRecord_clientId_ownerId_fkey",
    /FOREIGN KEY \(clientId, ownerId\).*AgentClient\(id, ownerId\)/,
  ],
  [
    "ActionProposal_clientId_ownerId_fkey",
    /FOREIGN KEY \(clientId, ownerId\).*AgentClient\(id, ownerId\)/,
  ],
  [
    "ApprovalGrant_clientId_ownerId_fkey",
    /FOREIGN KEY \(clientId, ownerId\).*AgentClient\(id, ownerId\)/,
  ],
  [
    "ApprovalGrant_proposalId_ownerId_clientId_fkey",
    /FOREIGN KEY \(proposalId, ownerId, clientId\).*ActionProposal\(id, ownerId, clientId\)/,
  ],
  [
    "MutationAuditEvent_ownerId_fkey",
    /FOREIGN KEY \(ownerId\).*User\(id\).*ON DELETE RESTRICT/,
  ],
  [
    "MutationAuditEvent_clientId_ownerId_fkey",
    /FOREIGN KEY \(clientId, ownerId\).*AgentClient\(id, ownerId\).*ON DELETE RESTRICT/,
  ],
  [
    "ActionOutbox_clientId_ownerId_fkey",
    /FOREIGN KEY \(clientId, ownerId\).*AgentClient\(id, ownerId\)/,
  ],
  [
    "ActionOutbox_grantId_ownerId_clientId_fkey",
    /FOREIGN KEY \(grantId, ownerId, clientId\).*ApprovalGrant\(id, ownerId, clientId\)/,
  ],
];

const expectedCalendarLocationColumns = {
  GoogleOAuthAttempt: [
    ["id", "text", "NO"],
    ["ownerId", "text", "NO"],
    ["stateMac", "text", "NO"],
    ["pkceCiphertext", "bytea", "NO"],
    ["pkceIv", "bytea", "NO"],
    ["pkceTag", "bytea", "NO"],
    ["pkceKeyVersion", "integer", "NO"],
    ["expiresAt", "timestamp without time zone", "NO"],
    ["consumedAt", "timestamp without time zone", "YES"],
    ["createdAt", "timestamp without time zone", "NO", /CURRENT_TIMESTAMP/],
  ],
  GoogleCalendarConnection: [
    ["id", "text", "NO"],
    ["ownerId", "text", "NO"],
    ["refreshTokenCiphertext", "bytea", "NO"],
    ["refreshTokenIv", "bytea", "NO"],
    ["refreshTokenTag", "bytea", "NO"],
    ["refreshTokenKeyVersion", "integer", "NO"],
    ["grantedScopes", "ARRAY", "NO", /ARRAY\[\]::text\[\]/],
    ["status", "text", "NO", /'active'::text/],
    ["calendarListSyncTokenCiphertext", "bytea", "YES"],
    ["calendarListSyncTokenIv", "bytea", "YES"],
    ["calendarListSyncTokenTag", "bytea", "YES"],
    ["calendarListSyncTokenKeyVersion", "integer", "YES"],
    ["calendarListPendingAt", "timestamp without time zone", "YES"],
    ["calendarListLeaseUntil", "timestamp without time zone", "YES"],
    ["lastFullReconciledAt", "timestamp without time zone", "YES"],
    ["lastSyncedAt", "timestamp without time zone", "YES"],
    ["errorCode", "text", "YES"],
    ["createdAt", "timestamp without time zone", "NO", /CURRENT_TIMESTAMP/],
    ["updatedAt", "timestamp without time zone", "NO"],
  ],
  CalendarSource: [
    ["id", "text", "NO"],
    ["connectionId", "text", "NO"],
    ["ownerId", "text", "NO"],
    ["externalIdMac", "text", "NO"],
    ["externalIdCiphertext", "bytea", "NO"],
    ["externalIdIv", "bytea", "NO"],
    ["externalIdTag", "bytea", "NO"],
    ["externalIdKeyVersion", "integer", "NO"],
    ["nameCiphertext", "bytea", "NO"],
    ["nameIv", "bytea", "NO"],
    ["nameTag", "bytea", "NO"],
    ["nameKeyVersion", "integer", "NO"],
    ["timeZone", "text", "YES"],
    ["selected", "boolean", "NO", /false/],
    ["isPrimary", "boolean", "NO", /false/],
    ["syncTokenCiphertext", "bytea", "YES"],
    ["syncTokenIv", "bytea", "YES"],
    ["syncTokenTag", "bytea", "YES"],
    ["syncTokenKeyVersion", "integer", "YES"],
    ["fullSyncRequired", "boolean", "NO", /true/],
    ["pendingSyncAt", "timestamp without time zone", "YES"],
    ["syncLeaseUntil", "timestamp without time zone", "YES"],
    ["lastFullReconciledAt", "timestamp without time zone", "YES"],
    ["lastSyncedAt", "timestamp without time zone", "YES"],
    ["errorCode", "text", "YES"],
    ["createdAt", "timestamp without time zone", "NO", /CURRENT_TIMESTAMP/],
    ["updatedAt", "timestamp without time zone", "NO"],
  ],
  CalendarWatch: [
    ["id", "text", "NO"],
    ["connectionId", "text", "NO"],
    ["ownerId", "text", "NO"],
    ["targetType", "text", "NO"],
    ["targetKey", "text", "NO"],
    ["channelId", "text", "NO"],
    ["resourceIdMac", "text", "NO"],
    ["resourceIdCiphertext", "bytea", "NO"],
    ["resourceIdIv", "bytea", "NO"],
    ["resourceIdTag", "bytea", "NO"],
    ["resourceIdKeyVersion", "integer", "NO"],
    ["tokenMac", "text", "NO"],
    ["status", "text", "NO", /'active'::text/],
    ["expiresAt", "timestamp without time zone", "NO"],
    ["lastMessageNumber", "bigint", "YES"],
    ["createdAt", "timestamp without time zone", "NO", /CURRENT_TIMESTAMP/],
    ["updatedAt", "timestamp without time zone", "NO"],
  ],
  CalendarEvent: [
    ["id", "text", "NO"],
    ["ownerId", "text", "NO"],
    ["sourceId", "text", "NO"],
    ["externalEventIdMac", "text", "NO"],
    ["externalEventIdCiphertext", "bytea", "NO"],
    ["externalEventIdIv", "bytea", "NO"],
    ["externalEventIdTag", "bytea", "NO"],
    ["externalEventIdKeyVersion", "integer", "NO"],
    ["status", "text", "NO", /'confirmed'::text/],
    ["startAt", "timestamp without time zone", "YES"],
    ["endAt", "timestamp without time zone", "YES"],
    ["startDate", "date", "YES"],
    ["endDate", "date", "YES"],
    ["allDay", "boolean", "NO", /false/],
    ["timeZone", "text", "YES"],
    ["transparency", "text", "NO", /'opaque'::text/],
    ["recurringEventIdMac", "text", "YES"],
    ["recurringEventIdCiphertext", "bytea", "YES"],
    ["recurringEventIdIv", "bytea", "YES"],
    ["recurringEventIdTag", "bytea", "YES"],
    ["recurringEventIdKeyVersion", "integer", "YES"],
    ["originalStartAt", "timestamp without time zone", "YES"],
    ["detailsCiphertext", "bytea", "YES"],
    ["detailsIv", "bytea", "YES"],
    ["detailsTag", "bytea", "YES"],
    ["detailsKeyVersion", "integer", "YES"],
    ["sourceUpdatedAt", "timestamp without time zone", "YES"],
    ["createdAt", "timestamp without time zone", "NO", /CURRENT_TIMESTAMP/],
    ["updatedAt", "timestamp without time zone", "NO"],
  ],
  LocationDevice: [
    ["id", "text", "NO"],
    ["ownerId", "text", "NO"],
    ["nameMac", "text", "NO"],
    ["nameCiphertext", "bytea", "NO"],
    ["nameIv", "bytea", "NO"],
    ["nameTag", "bytea", "NO"],
    ["nameKeyVersion", "integer", "NO"],
    ["username", "text", "NO"],
    ["credentialHash", "text", "NO"],
    ["externalDeviceIdMac", "text", "NO"],
    ["externalDeviceIdCiphertext", "bytea", "NO"],
    ["externalDeviceIdIv", "bytea", "NO"],
    ["externalDeviceIdTag", "bytea", "NO"],
    ["externalDeviceIdKeyVersion", "integer", "NO"],
    ["status", "text", "NO", /'active'::text/],
    ["rawRetentionDays", "integer", "NO", /90/],
    ["derivedRetentionDays", "integer", "NO", /730/],
    ["lastSeenAt", "timestamp without time zone", "YES"],
    ["createdAt", "timestamp without time zone", "NO", /CURRENT_TIMESTAMP/],
    ["updatedAt", "timestamp without time zone", "NO"],
  ],
  LocationSample: [
    ["id", "text", "NO"],
    ["ownerId", "text", "NO"],
    ["deviceId", "text", "NO"],
    ["recordedAt", "timestamp without time zone", "NO"],
    ["receivedAt", "timestamp without time zone", "NO"],
    ["coordinatesCiphertext", "bytea", "NO"],
    ["coordinatesIv", "bytea", "NO"],
    ["coordinatesTag", "bytea", "NO"],
    ["coordinatesKeyVersion", "integer", "NO"],
    ["accuracyM", "double precision", "YES"],
    ["batteryPercent", "integer", "YES"],
    ["trigger", "text", "YES"],
    ["payloadMac", "text", "NO"],
    ["createdAt", "timestamp without time zone", "NO", /CURRENT_TIMESTAMP/],
  ],
  DerivedVisit: [
    ["id", "text", "NO"],
    ["ownerId", "text", "NO"],
    ["deviceId", "text", "NO"],
    ["arrivedAt", "timestamp without time zone", "NO"],
    ["departedAt", "timestamp without time zone", "YES"],
    ["centroidCiphertext", "bytea", "NO"],
    ["centroidIv", "bytea", "NO"],
    ["centroidTag", "bytea", "NO"],
    ["centroidKeyVersion", "integer", "NO"],
    ["radiusM", "double precision", "NO"],
    ["confidence", "double precision", "NO"],
    ["sourceMac", "text", "NO"],
    ["derivationVersion", "integer", "NO", /1/],
    ["createdAt", "timestamp without time zone", "NO", /CURRENT_TIMESTAMP/],
    ["updatedAt", "timestamp without time zone", "NO"],
  ],
  LocationAlias: [
    ["id", "text", "NO"],
    ["ownerId", "text", "NO"],
    ["aliasMac", "text", "NO"],
    ["aliasCiphertext", "bytea", "NO"],
    ["aliasIv", "bytea", "NO"],
    ["aliasTag", "bytea", "NO"],
    ["aliasKeyVersion", "integer", "NO"],
    ["city", "text", "NO"],
    ["countryCode", "text", "NO"],
    ["timeZone", "text", "NO"],
    ["createdAt", "timestamp without time zone", "NO", /CURRENT_TIMESTAMP/],
    ["updatedAt", "timestamp without time zone", "NO"],
  ],
  CityStay: [
    ["id", "text", "NO"],
    ["ownerId", "text", "NO"],
    ["startsAt", "timestamp without time zone", "NO"],
    ["endsAt", "timestamp without time zone", "YES"],
    ["city", "text", "NO"],
    ["countryCode", "text", "NO"],
    ["timeZone", "text", "NO"],
    ["source", "text", "NO"],
    ["sourceId", "text", "NO"],
    ["confidence", "double precision", "NO"],
    ["createdAt", "timestamp without time zone", "NO", /CURRENT_TIMESTAMP/],
    ["updatedAt", "timestamp without time zone", "NO"],
  ],
  PersonalDataDeletionAudit: [
    ["id", "text", "NO"],
    ["ownerMac", "text", "NO"],
    ["idempotencyKeyMac", "text", "NO"],
    ["requestMac", "text", "NO"],
    ["categories", "ARRAY", "NO", /ARRAY\[\]::text\[\]/],
    ["calendarRowCount", "integer", "NO", /0/],
    ["locationRowCount", "integer", "NO", /0/],
    ["eventRowCount", "integer", "NO", /0/],
    ["deletedAt", "timestamp without time zone", "NO"],
    ["createdAt", "timestamp without time zone", "NO", /CURRENT_TIMESTAMP/],
  ],
};

const expectedCalendarLocationIndexes = [
  "GoogleOAuthAttempt_stateMac_key",
  "GoogleOAuthAttempt_id_ownerId_key",
  "GoogleOAuthAttempt_ownerId_expiresAt_consumedAt_idx",
  "GoogleCalendarConnection_ownerId_key",
  "GoogleCalendarConnection_id_ownerId_key",
  "GoogleCalendarConnection_status_calendarListPendingAt_calen_idx",
  "CalendarSource_connectionId_externalIdMac_key",
  "CalendarSource_id_ownerId_key",
  "CalendarSource_ownerId_selected_idx",
  "CalendarSource_pendingSyncAt_syncLeaseUntil_idx",
  "CalendarWatch_channelId_key",
  "CalendarWatch_id_ownerId_key",
  "CalendarWatch_connectionId_targetType_targetKey_status_idx",
  "CalendarWatch_status_expiresAt_idx",
  "CalendarEvent_sourceId_externalEventIdMac_key",
  "CalendarEvent_id_ownerId_key",
  "CalendarEvent_ownerId_startAt_endAt_status_idx",
  "CalendarEvent_sourceId_status_idx",
  "LocationDevice_username_key",
  "LocationDevice_ownerId_nameMac_key",
  "LocationDevice_ownerId_externalDeviceIdMac_key",
  "LocationDevice_id_ownerId_key",
  "LocationDevice_ownerId_status_idx",
  "LocationSample_deviceId_payloadMac_key",
  "LocationSample_id_ownerId_key",
  "LocationSample_ownerId_recordedAt_idx",
  "LocationSample_deviceId_recordedAt_idx",
  "DerivedVisit_deviceId_sourceMac_key",
  "DerivedVisit_id_ownerId_key",
  "DerivedVisit_ownerId_arrivedAt_departedAt_idx",
  "DerivedVisit_deviceId_arrivedAt_idx",
  "LocationAlias_ownerId_aliasMac_key",
  "LocationAlias_id_ownerId_key",
  "LocationAlias_ownerId_city_idx",
  "CityStay_ownerId_source_sourceId_key",
  "CityStay_id_ownerId_key",
  "CityStay_ownerId_startsAt_endsAt_idx",
  "PersonalDataDeletionAudit_idempotencyKeyMac_key",
  "PersonalDataDeletionAudit_ownerMac_deletedAt_idx",
];

const expectedCalendarLocationForeignKeys = [
  [
    "GoogleOAuthAttempt_ownerId_fkey",
    /FOREIGN KEY \(ownerId\).*User\(id\).*ON DELETE CASCADE/,
  ],
  [
    "GoogleCalendarConnection_ownerId_fkey",
    /FOREIGN KEY \(ownerId\).*User\(id\).*ON DELETE CASCADE/,
  ],
  [
    "CalendarSource_connectionId_ownerId_fkey",
    /FOREIGN KEY \(connectionId, ownerId\).*GoogleCalendarConnection\(id, ownerId\).*ON DELETE CASCADE/,
  ],
  [
    "CalendarSource_ownerId_fkey",
    /FOREIGN KEY \(ownerId\).*User\(id\).*ON DELETE CASCADE/,
  ],
  [
    "CalendarWatch_connectionId_ownerId_fkey",
    /FOREIGN KEY \(connectionId, ownerId\).*GoogleCalendarConnection\(id, ownerId\).*ON DELETE CASCADE/,
  ],
  [
    "CalendarWatch_ownerId_fkey",
    /FOREIGN KEY \(ownerId\).*User\(id\).*ON DELETE CASCADE/,
  ],
  [
    "CalendarEvent_sourceId_ownerId_fkey",
    /FOREIGN KEY \(sourceId, ownerId\).*CalendarSource\(id, ownerId\).*ON DELETE CASCADE/,
  ],
  [
    "CalendarEvent_ownerId_fkey",
    /FOREIGN KEY \(ownerId\).*User\(id\).*ON DELETE CASCADE/,
  ],
  [
    "LocationDevice_ownerId_fkey",
    /FOREIGN KEY \(ownerId\).*User\(id\).*ON DELETE CASCADE/,
  ],
  [
    "LocationSample_deviceId_ownerId_fkey",
    /FOREIGN KEY \(deviceId, ownerId\).*LocationDevice\(id, ownerId\).*ON DELETE CASCADE/,
  ],
  [
    "LocationSample_ownerId_fkey",
    /FOREIGN KEY \(ownerId\).*User\(id\).*ON DELETE CASCADE/,
  ],
  [
    "DerivedVisit_deviceId_ownerId_fkey",
    /FOREIGN KEY \(deviceId, ownerId\).*LocationDevice\(id, ownerId\).*ON DELETE CASCADE/,
  ],
  [
    "DerivedVisit_ownerId_fkey",
    /FOREIGN KEY \(ownerId\).*User\(id\).*ON DELETE CASCADE/,
  ],
  [
    "LocationAlias_ownerId_fkey",
    /FOREIGN KEY \(ownerId\).*User\(id\).*ON DELETE CASCADE/,
  ],
  [
    "CityStay_ownerId_fkey",
    /FOREIGN KEY \(ownerId\).*User\(id\).*ON DELETE CASCADE/,
  ],
];

const expectedCalendarLocationChecks = [
  "GoogleOAuthAttempt_stateMac_check",
  "GoogleOAuthAttempt_pkceEnvelope_check",
  "GoogleCalendarConnection_refreshTokenEnvelope_check",
  "GoogleCalendarConnection_status_check",
  "GoogleCalendarConnection_calendarListSyncTokenEnvelope_check",
  "CalendarSource_externalIdMac_check",
  "CalendarSource_externalIdEnvelope_check",
  "CalendarSource_nameEnvelope_check",
  "CalendarSource_syncTokenEnvelope_check",
  "CalendarWatch_targetType_check",
  "CalendarWatch_status_check",
  "CalendarWatch_resourceIdMac_check",
  "CalendarWatch_resourceIdEnvelope_check",
  "CalendarWatch_tokenMac_check",
  "CalendarEvent_externalEventIdMac_check",
  "CalendarEvent_externalEventIdEnvelope_check",
  "CalendarEvent_status_check",
  "CalendarEvent_transparency_check",
  "CalendarEvent_recurringEventIdMac_check",
  "CalendarEvent_recurringEventIdEnvelope_check",
  "CalendarEvent_detailsEnvelope_check",
  "CalendarEvent_timing_check",
  "CalendarEvent_allDay_check",
  "LocationDevice_nameMac_check",
  "LocationDevice_nameEnvelope_check",
  "LocationDevice_username_check",
  "LocationDevice_credentialHash_check",
  "LocationDevice_externalDeviceIdMac_check",
  "LocationDevice_externalDeviceIdEnvelope_check",
  "LocationDevice_status_check",
  "LocationDevice_rawRetentionDays_check",
  "LocationDevice_derivedRetentionDays_check",
  "LocationSample_coordinatesEnvelope_check",
  "LocationSample_accuracyM_check",
  "LocationSample_batteryPercent_check",
  "LocationSample_payloadMac_check",
  "DerivedVisit_centroidEnvelope_check",
  "DerivedVisit_radiusM_check",
  "DerivedVisit_confidence_check",
  "DerivedVisit_sourceMac_check",
  "DerivedVisit_timeRange_check",
  "LocationAlias_aliasMac_check",
  "LocationAlias_aliasEnvelope_check",
  "CityStay_source_check",
  "CityStay_confidence_check",
  "CityStay_timeRange_check",
  "PersonalDataDeletionAudit_ownerMac_check",
  "PersonalDataDeletionAudit_idempotencyKeyMac_check",
  "PersonalDataDeletionAudit_requestMac_check",
  "PersonalDataDeletionAudit_rowCounts_check",
];

test("approval persistence derives executable data only from the proposal", () => {
  const schema = readFileSync(
    resolve(root, "services/api/prisma/schema.prisma"),
    "utf8",
  );
  const migration = readFileSync(agentInterfaceMigrationPath, "utf8");
  const grantModel =
    schema.match(/model ApprovalGrant \{[\s\S]*?\n\}/)?.[0] ?? "";
  const outboxModel =
    schema.match(/model ActionOutbox \{[\s\S]*?\n\}/)?.[0] ?? "";
  const grantTable =
    migration.match(/CREATE TABLE "ApprovalGrant" \([\s\S]*?\n\);/)?.[0] ?? "";
  const outboxTable =
    migration.match(/CREATE TABLE "ActionOutbox" \([\s\S]*?\n\);/)?.[0] ?? "";

  assert.doesNotMatch(grantModel, /^\s+(?:actionType|payloadHash)\s/m);
  assert.doesNotMatch(outboxModel, /^\s+(?:actionType|payloadHash|payload)\s/m);
  assert.doesNotMatch(grantTable, /^\s+"(?:actionType|payloadHash)"\s/m);
  assert.doesNotMatch(
    outboxTable,
    /^\s+"(?:actionType|payloadHash|payload)"\s/m,
  );
  assert.match(
    migration,
    /CONSTRAINT "ActionProposal_riskLevel_check" CHECK \("riskLevel" = 'approval_required'\)/,
  );
  assert.doesNotMatch(migration, /pg_trigger_depth\s*\(/);
});

test("calendar and location schema declares the exact encrypted persistence boundary", () => {
  const schema = readFileSync(
    resolve(root, "services/api/prisma/schema.prisma"),
    "utf8",
  );
  assert.equal(
    existsSync(calendarLocationMigrationPath),
    true,
    "calendar/location migration file is missing",
  );
  const migration = existsSync(calendarLocationMigrationPath)
    ? readFileSync(calendarLocationMigrationPath, "utf8")
    : "";

  for (const table of Object.keys(expectedCalendarLocationColumns)) {
    assert.match(
      schema,
      new RegExp(`model ${table} \\{`),
      `missing Prisma model ${table}`,
    );
    assert.match(
      migration,
      new RegExp(`CREATE TABLE "${table}"`),
      `missing SQL table ${table}`,
    );
  }
  for (const check of expectedCalendarLocationChecks) {
    assert.match(
      migration,
      new RegExp(`CONSTRAINT "${check}" CHECK`),
      `missing named check ${check}`,
    );
  }
  assert.match(
    migration,
    /CREATE FUNCTION "reject_personal_data_deletion_audit_change"\(\) RETURNS trigger/,
  );
  assert.match(
    migration,
    /CREATE TRIGGER "PersonalDataDeletionAudit_append_only"[\s\S]*BEFORE UPDATE OR DELETE ON "PersonalDataDeletionAudit"/,
  );
  assert.doesNotMatch(
    migration,
    /CREATE UNIQUE INDEX "CalendarWatch_connectionId_targetType_targetKey(?:_status)?_key"/,
  );
});

if (!databaseUrl) {
  test(
    "migration safety integration requires TEST_DATABASE_URL",
    { skip: true },
    () => {},
  );
} else {
  const parsedUrl = new URL(databaseUrl);
  assert.match(
    basename(parsedUrl.pathname),
    /^socos_migration_test_[a-z0-9_]*_test$/,
    "integration tests require the socos_migration_test_ prefix and _test suffix",
  );

  const requireFromApi = createRequire(
    resolve(root, "services/api/package.json"),
  );
  const { Client } = requireFromApi("pg");

  async function withClient(callback) {
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      return await callback(client);
    } finally {
      await client.end();
    }
  }

  async function resetLegacySchema(client) {
    await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    for (const path of migrationPaths) {
      await client.query(readFileSync(resolve(root, path), "utf8"));
    }
  }

  async function columnExists(client, table, column) {
    const result = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
       ) AS present`,
      [table, column],
    );
    return result.rows[0].present;
  }

  async function tableExists(client, table) {
    const result = await client.query(
      `SELECT to_regclass('public.' || quote_ident($1)) IS NOT NULL AS present`,
      [table],
    );
    return result.rows[0].present;
  }

  async function assertDailyBriefSchema(client) {
    for (const table of expectedBriefTables) {
      assert.equal(
        await tableExists(client, table),
        true,
        `missing table ${table}`,
      );
    }

    for (const column of ["importance", "preferredCadenceDays"]) {
      assert.equal(
        await columnExists(client, "Contact", column),
        true,
        `missing Contact.${column}`,
      );
    }
    for (const column of ["timeZone", "briefHourLocal"]) {
      assert.equal(
        await columnExists(client, "User", column),
        true,
        `missing User.${column}`,
      );
    }

    const indexes = await client.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [expectedUniqueIndexes],
    );
    assert.deepEqual(
      indexes.rows.map(({ indexname }) => indexname).sort(),
      [...expectedUniqueIndexes].sort(),
    );
    for (const { indexname, indexdef } of indexes.rows) {
      assert.match(
        indexdef,
        /^CREATE UNIQUE INDEX /,
        `${indexname} must remain unique`,
      );
    }

    const checks = await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conname = ANY($1::text[])`,
      [expectedChecks.map(([name]) => name)],
    );
    const definitions = new Map(
      checks.rows.map(({ conname, definition }) => [
        conname,
        definition.replaceAll('"', ""),
      ]),
    );
    for (const [name, pattern] of expectedChecks) {
      assert.match(
        definitions.get(name) ?? "",
        pattern,
        `missing or invalid check ${name}`,
      );
    }
  }

  async function assertAgentInterfaceSchema(client) {
    for (const table of expectedAgentTables) {
      assert.equal(
        await tableExists(client, table),
        true,
        `missing table ${table}`,
      );
    }

    const expectedIndexes = [
      ...expectedAgentUniqueIndexes,
      ...expectedAgentExpiryIndexes,
    ];
    const indexes = await client.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [expectedIndexes],
    );
    assert.deepEqual(
      indexes.rows.map(({ indexname }) => indexname).sort(),
      [...expectedIndexes].sort(),
    );
    for (const { indexname, indexdef } of indexes.rows) {
      if (expectedAgentUniqueIndexes.includes(indexname)) {
        assert.match(
          indexdef,
          /^CREATE UNIQUE INDEX /,
          `${indexname} must remain unique`,
        );
      }
    }

    const constraintNames = [
      ...expectedAgentChecks.map(([name]) => name),
      ...expectedAgentForeignKeys.map(([name]) => name),
    ];
    const constraints = await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conname = ANY($1::text[])`,
      [constraintNames],
    );
    const definitions = new Map(
      constraints.rows.map(({ conname, definition }) => [
        conname,
        definition.replaceAll('"', ""),
      ]),
    );
    for (const [name, pattern] of [
      ...expectedAgentChecks,
      ...expectedAgentForeignKeys,
    ]) {
      assert.match(
        definitions.get(name) ?? "",
        pattern,
        `missing or invalid constraint ${name}`,
      );
    }
  }

  async function assertCalendarLocationSchema(client) {
    const tables = Object.keys(expectedCalendarLocationColumns);
    for (const table of tables) {
      assert.equal(
        await tableExists(client, table),
        true,
        `missing table ${table}`,
      );

      const result = await client.query(
        `SELECT column_name, data_type, udt_name, is_nullable, column_default,
                datetime_precision
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position`,
        [table],
      );
      const expected = expectedCalendarLocationColumns[table];
      assert.deepEqual(
        result.rows.map(({ column_name }) => column_name),
        expected.map(([name]) => name),
        `${table} columns differ from the contract`,
      );
      for (const [name, type, nullable, defaultPattern] of expected) {
        const column = result.rows.find((row) => row.column_name === name);
        assert.equal(
          column?.data_type,
          type,
          `${table}.${name} has the wrong type`,
        );
        assert.equal(
          column?.is_nullable,
          nullable,
          `${table}.${name} has the wrong nullability`,
        );
        if (type === "timestamp without time zone") {
          assert.equal(
            column?.datetime_precision,
            3,
            `${table}.${name} must use TIMESTAMP(3)`,
          );
        }
        if (type === "ARRAY") {
          assert.equal(
            column?.udt_name,
            "_text",
            `${table}.${name} must use PostgreSQL TEXT[]`,
          );
        }
        if (defaultPattern) {
          assert.match(
            column?.column_default ?? "",
            defaultPattern,
            `${table}.${name} has the wrong default`,
          );
        } else {
          assert.equal(
            column?.column_default,
            null,
            `${table}.${name} must not have a SQL default`,
          );
        }
      }
    }

    const primaryKeys = await client.query(
      `SELECT conname FROM pg_constraint
        WHERE contype = 'p' AND conrelid = ANY($1::regclass[])`,
      [tables.map((table) => `public."${table}"`)],
    );
    assert.deepEqual(
      primaryKeys.rows.map(({ conname }) => conname).sort(),
      tables.map((table) => `${table}_pkey`).sort(),
      "calendar/location primary-key names differ from the contract",
    );

    const indexes = await client.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [expectedCalendarLocationIndexes],
    );
    assert.deepEqual(
      indexes.rows.map(({ indexname }) => indexname).sort(),
      [...expectedCalendarLocationIndexes].sort(),
      "calendar/location indexes differ from the contract",
    );
    const forbiddenWatchUnique = await client.query(
      `SELECT count(*)::int AS count FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'CalendarWatch'
          AND indexdef LIKE 'CREATE UNIQUE INDEX%'
          AND indexdef LIKE '%("connectionId", "targetType", "targetKey")%'`,
    );
    assert.equal(forbiddenWatchUnique.rows[0].count, 0);

    const constraintNames = [
      ...expectedCalendarLocationChecks,
      ...expectedCalendarLocationForeignKeys.map(([name]) => name),
    ];
    const constraints = await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conname = ANY($1::text[])`,
      [constraintNames],
    );
    const definitions = new Map(
      constraints.rows.map(({ conname, definition }) => [
        conname,
        definition.replaceAll('"', ""),
      ]),
    );
    const coveredChecks = new Set();
    const assertCheck = (name, ...patterns) => {
      const definition = definitions.get(name) ?? "";
      assert.match(definition, /^CHECK /, `missing named check ${name}`);
      for (const pattern of patterns) {
        assert.match(definition, pattern, `invalid check ${name}`);
      }
      coveredChecks.add(name);
    };
    const macChecks = {
      GoogleOAuthAttempt_stateMac_check: "stateMac",
      CalendarSource_externalIdMac_check: "externalIdMac",
      CalendarWatch_resourceIdMac_check: "resourceIdMac",
      CalendarWatch_tokenMac_check: "tokenMac",
      CalendarEvent_externalEventIdMac_check: "externalEventIdMac",
      CalendarEvent_recurringEventIdMac_check: "recurringEventIdMac",
      LocationDevice_nameMac_check: "nameMac",
      LocationDevice_externalDeviceIdMac_check: "externalDeviceIdMac",
      LocationSample_payloadMac_check: "payloadMac",
      DerivedVisit_sourceMac_check: "sourceMac",
      LocationAlias_aliasMac_check: "aliasMac",
      PersonalDataDeletionAudit_ownerMac_check: "ownerMac",
      PersonalDataDeletionAudit_idempotencyKeyMac_check: "idempotencyKeyMac",
      PersonalDataDeletionAudit_requestMac_check: "requestMac",
    };
    for (const [name, field] of Object.entries(macChecks)) {
      assertCheck(name, new RegExp(`${field}.*\\^\\[0-9a-f\\]\\{64\\}\\$`));
    }
    const requiredEnvelopeChecks = {
      GoogleOAuthAttempt_pkceEnvelope_check: [
        "pkceKeyVersion",
        "pkceIv",
        "pkceTag",
      ],
      GoogleCalendarConnection_refreshTokenEnvelope_check: [
        "refreshTokenKeyVersion",
        "refreshTokenIv",
        "refreshTokenTag",
      ],
      CalendarSource_externalIdEnvelope_check: [
        "externalIdKeyVersion",
        "externalIdIv",
        "externalIdTag",
      ],
      CalendarSource_nameEnvelope_check: [
        "nameKeyVersion",
        "nameIv",
        "nameTag",
      ],
      CalendarWatch_resourceIdEnvelope_check: [
        "resourceIdKeyVersion",
        "resourceIdIv",
        "resourceIdTag",
      ],
      CalendarEvent_externalEventIdEnvelope_check: [
        "externalEventIdKeyVersion",
        "externalEventIdIv",
        "externalEventIdTag",
      ],
      LocationDevice_nameEnvelope_check: [
        "nameKeyVersion",
        "nameIv",
        "nameTag",
      ],
      LocationDevice_externalDeviceIdEnvelope_check: [
        "externalDeviceIdKeyVersion",
        "externalDeviceIdIv",
        "externalDeviceIdTag",
      ],
      LocationSample_coordinatesEnvelope_check: [
        "coordinatesKeyVersion",
        "coordinatesIv",
        "coordinatesTag",
      ],
      DerivedVisit_centroidEnvelope_check: [
        "centroidKeyVersion",
        "centroidIv",
        "centroidTag",
      ],
      LocationAlias_aliasEnvelope_check: [
        "aliasKeyVersion",
        "aliasIv",
        "aliasTag",
      ],
    };
    for (const [name, [keyVersion, ivField, tagField]] of Object.entries(
      requiredEnvelopeChecks,
    )) {
      assertCheck(
        name,
        new RegExp(`${keyVersion} > 0`),
        new RegExp(`octet_length\\(${ivField}\\) = 12`),
        new RegExp(`octet_length\\(${tagField}\\) = 16`),
      );
    }
    const optionalEnvelopeChecks = {
      GoogleCalendarConnection_calendarListSyncTokenEnvelope_check: [
        "calendarListSyncTokenKeyVersion",
        "calendarListSyncTokenIv",
        "calendarListSyncTokenTag",
      ],
      CalendarSource_syncTokenEnvelope_check: [
        "syncTokenKeyVersion",
        "syncTokenIv",
        "syncTokenTag",
      ],
      CalendarEvent_recurringEventIdEnvelope_check: [
        "recurringEventIdKeyVersion",
        "recurringEventIdIv",
        "recurringEventIdTag",
      ],
      CalendarEvent_detailsEnvelope_check: [
        "detailsKeyVersion",
        "detailsIv",
        "detailsTag",
      ],
    };
    for (const [name, [keyVersion, ivField, tagField]] of Object.entries(
      optionalEnvelopeChecks,
    )) {
      assertCheck(
        name,
        /num_nonnulls/,
        /ANY \(ARRAY\[0, 4\]\)/,
        new RegExp(`${keyVersion} > 0`),
        new RegExp(`octet_length\\(${ivField}\\) = 12`),
        new RegExp(`octet_length\\(${tagField}\\) = 16`),
      );
    }
    assertCheck(
      "GoogleCalendarConnection_status_check",
      /active/,
      /needs_reauth/,
      /disconnected/,
    );
    assertCheck("CalendarWatch_targetType_check", /calendar_list/, /events/);
    assertCheck("CalendarWatch_status_check", /active/, /stopping/);
    assertCheck(
      "CalendarEvent_status_check",
      /confirmed/,
      /tentative/,
      /cancelled/,
    );
    assertCheck("CalendarEvent_transparency_check", /opaque/, /transparent/);
    assertCheck("LocationDevice_status_check", /active/, /revoked/);
    assertCheck("LocationDevice_username_check", /A-Za-z0-9_-/, /\{32\}/);
    assertCheck(
      "LocationDevice_credentialHash_check",
      /scrypt/,
      /32768/,
      /\{22\}/,
      /\{43\}/,
    );
    assertCheck(
      "LocationDevice_rawRetentionDays_check",
      /rawRetentionDays >= 30/,
      /rawRetentionDays <= 365/,
    );
    assertCheck(
      "LocationDevice_derivedRetentionDays_check",
      /derivedRetentionDays >= 90/,
      /derivedRetentionDays <= 3650/,
    );
    assertCheck(
      "LocationSample_accuracyM_check",
      /accuracyM >=/,
      /accuracyM <=/,
    );
    assertCheck(
      "LocationSample_batteryPercent_check",
      /batteryPercent >= 0/,
      /batteryPercent <= 100/,
    );
    assertCheck("DerivedVisit_radiusM_check", /radiusM >=/, /radiusM <=/);
    assertCheck(
      "DerivedVisit_confidence_check",
      /confidence >=/,
      /confidence <=/,
    );
    assertCheck(
      "DerivedVisit_timeRange_check",
      /departedAt IS NULL/,
      /departedAt > arrivedAt/,
    );
    assertCheck("CityStay_source_check", /source = 'calendar'/);
    assertCheck("CityStay_confidence_check", /confidence >=/, /confidence <=/);
    assertCheck(
      "CityStay_timeRange_check",
      /endsAt IS NULL/,
      /endsAt > startsAt/,
    );
    assertCheck(
      "CalendarEvent_timing_check",
      /status = 'cancelled'/,
      /endAt > startAt/,
      /detailsCiphertext IS NOT NULL/,
    );
    assertCheck(
      "CalendarEvent_allDay_check",
      /allDay/,
      /endDate > startDate/,
      /startDate IS NULL/,
      /endDate IS NULL/,
    );
    assertCheck(
      "PersonalDataDeletionAudit_rowCounts_check",
      /calendarRowCount >= 0/,
      /locationRowCount >= 0/,
      /eventRowCount >= 0/,
    );
    assert.deepEqual(
      [...coveredChecks].sort(),
      [...expectedCalendarLocationChecks].sort(),
      "every named calendar/location check must have a semantic assertion",
    );
    for (const [name, pattern] of expectedCalendarLocationForeignKeys) {
      assert.match(
        definitions.get(name) ?? "",
        pattern,
        `missing or invalid FK ${name}`,
      );
    }

    const trigger = await client.query(
      `SELECT p.proname, t.tgname, pg_get_triggerdef(t.oid) AS definition
         FROM pg_trigger t
         JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE NOT t.tgisinternal AND t.tgname = 'PersonalDataDeletionAudit_append_only'`,
    );
    assert.equal(trigger.rows.length, 1);
    assert.equal(
      trigger.rows[0].proname,
      "reject_personal_data_deletion_audit_change",
    );
    assert.match(
      trigger.rows[0].definition,
      /BEFORE (?:UPDATE OR DELETE|DELETE OR UPDATE)/,
    );
  }

  async function assertCalendarLocationBehavior(client) {
    const iv = "decode(repeat('00', 12), 'hex')";
    const tag = "decode(repeat('00', 16), 'hex')";
    const ciphertext = "decode('01', 'hex')";
    const expectConstraint = async (sql, name) => {
      await assert.rejects(
        client.query(sql),
        new RegExp(`constraint "${name}"`, "i"),
      );
    };

    await client.query(
      `INSERT INTO "User" ("id", "email", "updatedAt") VALUES
         ('calendar-owner', 'calendar-owner@example.invalid', CURRENT_TIMESTAMP),
         ('calendar-other-owner', 'calendar-other-owner@example.invalid', CURRENT_TIMESTAMP);
       INSERT INTO "GoogleOAuthAttempt" (
         "id", "ownerId", "stateMac", "pkceCiphertext", "pkceIv", "pkceTag",
         "pkceKeyVersion", "expiresAt"
       ) VALUES (
         'oauth-valid', 'calendar-owner', repeat('a', 64), ${ciphertext}, ${iv}, ${tag},
         1, CURRENT_TIMESTAMP + INTERVAL '10 minutes'
       );
       INSERT INTO "GoogleCalendarConnection" (
         "id", "ownerId", "refreshTokenCiphertext", "refreshTokenIv",
         "refreshTokenTag", "refreshTokenKeyVersion", "updatedAt"
       ) VALUES (
         'connection-valid', 'calendar-owner', ${ciphertext}, ${iv}, ${tag}, 1,
         CURRENT_TIMESTAMP
       );
       INSERT INTO "CalendarSource" (
         "id", "connectionId", "ownerId", "externalIdMac", "externalIdCiphertext",
         "externalIdIv", "externalIdTag", "externalIdKeyVersion", "nameCiphertext",
         "nameIv", "nameTag", "nameKeyVersion", "updatedAt"
       ) VALUES (
         'source-valid', 'connection-valid', 'calendar-owner', repeat('b', 64),
         ${ciphertext}, ${iv}, ${tag}, 1, ${ciphertext}, ${iv}, ${tag}, 1,
         CURRENT_TIMESTAMP
       );
       INSERT INTO "CalendarWatch" (
         "id", "connectionId", "ownerId", "targetType", "targetKey", "channelId",
         "resourceIdMac", "resourceIdCiphertext", "resourceIdIv", "resourceIdTag",
         "resourceIdKeyVersion", "tokenMac", "expiresAt", "updatedAt"
       ) VALUES
       (
         'watch-valid-1', 'connection-valid', 'calendar-owner', 'events', 'primary',
         'channel-valid-1', repeat('c', 64), ${ciphertext}, ${iv}, ${tag}, 1,
         repeat('d', 64), CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP
       ),
       (
         'watch-valid-2', 'connection-valid', 'calendar-owner', 'events', 'primary',
         'channel-valid-2', repeat('e', 64), ${ciphertext}, ${iv}, ${tag}, 1,
         repeat('f', 64), CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP
       );
       INSERT INTO "CalendarEvent" (
         "id", "ownerId", "sourceId", "externalEventIdMac", "externalEventIdCiphertext",
         "externalEventIdIv", "externalEventIdTag", "externalEventIdKeyVersion",
         "startAt", "endAt", "detailsCiphertext", "detailsIv", "detailsTag",
         "detailsKeyVersion", "updatedAt"
       ) VALUES (
         'event-valid', 'calendar-owner', 'source-valid', repeat('1', 64),
         ${ciphertext}, ${iv}, ${tag}, 1, CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP + INTERVAL '1 hour', ${ciphertext}, ${iv}, ${tag}, 1,
         CURRENT_TIMESTAMP
       );
       INSERT INTO "CalendarEvent" (
         "id", "ownerId", "sourceId", "externalEventIdMac", "externalEventIdCiphertext",
         "externalEventIdIv", "externalEventIdTag", "externalEventIdKeyVersion",
         "status", "updatedAt"
       ) VALUES (
         'event-tombstone', 'calendar-owner', 'source-valid', repeat('2', 64),
         ${ciphertext}, ${iv}, ${tag}, 1, 'cancelled', CURRENT_TIMESTAMP
       );
       INSERT INTO "LocationDevice" (
         "id", "ownerId", "nameMac", "nameCiphertext", "nameIv", "nameTag",
         "nameKeyVersion", "username", "credentialHash", "externalDeviceIdMac",
         "externalDeviceIdCiphertext", "externalDeviceIdIv", "externalDeviceIdTag",
         "externalDeviceIdKeyVersion", "updatedAt"
       ) VALUES (
         'device-valid', 'calendar-owner', repeat('3', 64), ${ciphertext}, ${iv}, ${tag}, 1,
         repeat('u', 32), 'scrypt$32768$8$1$ssssssssssssssssssssss$hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh',
         repeat('4', 64), ${ciphertext}, ${iv}, ${tag}, 1, CURRENT_TIMESTAMP
       );
       INSERT INTO "LocationSample" (
         "id", "ownerId", "deviceId", "recordedAt", "receivedAt",
         "coordinatesCiphertext", "coordinatesIv", "coordinatesTag",
         "coordinatesKeyVersion", "accuracyM", "batteryPercent", "payloadMac"
       ) VALUES (
         'sample-valid', 'calendar-owner', 'device-valid', CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP, ${ciphertext}, ${iv}, ${tag}, 1, 3.5, 50, repeat('5', 64)
       );
       INSERT INTO "DerivedVisit" (
         "id", "ownerId", "deviceId", "arrivedAt", "departedAt", "centroidCiphertext",
         "centroidIv", "centroidTag", "centroidKeyVersion", "radiusM", "confidence",
         "sourceMac", "updatedAt"
       ) VALUES (
         'visit-valid', 'calendar-owner', 'device-valid', CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP + INTERVAL '1 hour', ${ciphertext}, ${iv}, ${tag}, 1,
         10, 0.8, repeat('6', 64), CURRENT_TIMESTAMP
       );
       INSERT INTO "LocationAlias" (
         "id", "ownerId", "aliasMac", "aliasCiphertext", "aliasIv", "aliasTag",
         "aliasKeyVersion", "city", "countryCode", "timeZone", "updatedAt"
       ) VALUES (
         'alias-valid', 'calendar-owner', repeat('7', 64), ${ciphertext}, ${iv}, ${tag},
         1, 'Synthetic City', 'SC', 'Etc/UTC', CURRENT_TIMESTAMP
       );
       INSERT INTO "CityStay" (
         "id", "ownerId", "startsAt", "endsAt", "city", "countryCode", "timeZone",
         "source", "sourceId", "confidence", "updatedAt"
       ) VALUES (
         'stay-valid', 'calendar-owner', CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP + INTERVAL '1 day', 'Synthetic City', 'SC', 'Etc/UTC',
         'calendar', 'synthetic-source', 0.9, CURRENT_TIMESTAMP
       );
       INSERT INTO "PersonalDataDeletionAudit" (
         "id", "ownerMac", "idempotencyKeyMac", "requestMac", "deletedAt"
       ) VALUES (
         'deletion-audit-valid', repeat('8', 64), repeat('9', 64), repeat('a', 64),
         CURRENT_TIMESTAMP
       );`,
    );

    const defaults = await client.query(
      `SELECT
         (SELECT json_build_object('status', "status", 'scopes', "grantedScopes")
            FROM "GoogleCalendarConnection" WHERE "id" = 'connection-valid') AS connection,
         (SELECT json_build_object('selected', "selected", 'primary', "isPrimary", 'full', "fullSyncRequired")
            FROM "CalendarSource" WHERE "id" = 'source-valid') AS source,
         (SELECT json_build_object('status', "status", 'raw', "rawRetentionDays", 'derived', "derivedRetentionDays")
            FROM "LocationDevice" WHERE "id" = 'device-valid') AS device,
         (SELECT "derivationVersion" FROM "DerivedVisit" WHERE "id" = 'visit-valid') AS derivation,
         (SELECT json_build_object('categories', "categories", 'calendar', "calendarRowCount", 'location', "locationRowCount", 'event', "eventRowCount")
            FROM "PersonalDataDeletionAudit" WHERE "id" = 'deletion-audit-valid') AS audit`,
    );
    assert.deepEqual(defaults.rows[0], {
      connection: { status: "active", scopes: [] },
      source: { selected: false, primary: false, full: true },
      device: { status: "active", raw: 90, derived: 730 },
      derivation: 1,
      audit: { categories: [], calendar: 0, location: 0, event: 0 },
    });

    await expectConstraint(
      `UPDATE "GoogleCalendarConnection" SET "calendarListSyncTokenCiphertext" = ${ciphertext} WHERE "id" = 'connection-valid'`,
      "GoogleCalendarConnection_calendarListSyncTokenEnvelope_check",
    );
    await expectConstraint(
      `UPDATE "GoogleOAuthAttempt" SET "pkceIv" = decode('00', 'hex') WHERE "id" = 'oauth-valid'`,
      "GoogleOAuthAttempt_pkceEnvelope_check",
    );
    await expectConstraint(
      `UPDATE "GoogleOAuthAttempt" SET "stateMac" = 'ABC' WHERE "id" = 'oauth-valid'`,
      "GoogleOAuthAttempt_stateMac_check",
    );
    await expectConstraint(
      `UPDATE "GoogleCalendarConnection" SET "status" = 'unknown' WHERE "id" = 'connection-valid'`,
      "GoogleCalendarConnection_status_check",
    );
    await expectConstraint(
      `UPDATE "CalendarEvent" SET "endAt" = "startAt" WHERE "id" = 'event-valid'`,
      "CalendarEvent_timing_check",
    );
    await expectConstraint(
      `UPDATE "CalendarEvent" SET "detailsCiphertext" = NULL, "detailsIv" = NULL, "detailsTag" = NULL, "detailsKeyVersion" = NULL WHERE "id" = 'event-valid'`,
      "CalendarEvent_timing_check",
    );
    await expectConstraint(
      `UPDATE "CalendarEvent" SET "allDay" = true, "startDate" = DATE '2026-01-02', "endDate" = DATE '2026-01-01' WHERE "id" = 'event-valid'`,
      "CalendarEvent_allDay_check",
    );
    await expectConstraint(
      `UPDATE "LocationDevice" SET "username" = 'short' WHERE "id" = 'device-valid'`,
      "LocationDevice_username_check",
    );
    await expectConstraint(
      `UPDATE "LocationDevice" SET "credentialHash" = 'scrypt$bad' WHERE "id" = 'device-valid'`,
      "LocationDevice_credentialHash_check",
    );
    await expectConstraint(
      `UPDATE "LocationDevice" SET "rawRetentionDays" = 29 WHERE "id" = 'device-valid'`,
      "LocationDevice_rawRetentionDays_check",
    );
    await expectConstraint(
      `UPDATE "LocationDevice" SET "derivedRetentionDays" = 3651 WHERE "id" = 'device-valid'`,
      "LocationDevice_derivedRetentionDays_check",
    );
    await expectConstraint(
      `UPDATE "LocationSample" SET "accuracyM" = 'NaN'::double precision WHERE "id" = 'sample-valid'`,
      "LocationSample_accuracyM_check",
    );
    await expectConstraint(
      `UPDATE "LocationSample" SET "batteryPercent" = 101 WHERE "id" = 'sample-valid'`,
      "LocationSample_batteryPercent_check",
    );
    await expectConstraint(
      `UPDATE "DerivedVisit" SET "radiusM" = 'Infinity'::double precision WHERE "id" = 'visit-valid'`,
      "DerivedVisit_radiusM_check",
    );
    await expectConstraint(
      `UPDATE "DerivedVisit" SET "confidence" = 'NaN'::double precision WHERE "id" = 'visit-valid'`,
      "DerivedVisit_confidence_check",
    );
    await expectConstraint(
      `UPDATE "DerivedVisit" SET "departedAt" = "arrivedAt" WHERE "id" = 'visit-valid'`,
      "DerivedVisit_timeRange_check",
    );
    await expectConstraint(
      `UPDATE "CityStay" SET "source" = 'device' WHERE "id" = 'stay-valid'`,
      "CityStay_source_check",
    );
    await expectConstraint(
      `UPDATE "CityStay" SET "confidence" = 'NaN'::double precision WHERE "id" = 'stay-valid'`,
      "CityStay_confidence_check",
    );
    await expectConstraint(
      `UPDATE "CityStay" SET "endsAt" = "startsAt" WHERE "id" = 'stay-valid'`,
      "CityStay_timeRange_check",
    );
    await expectConstraint(
      `INSERT INTO "PersonalDataDeletionAudit" (
         "id", "ownerMac", "idempotencyKeyMac", "requestMac", "calendarRowCount", "deletedAt"
       ) VALUES (
         'deletion-audit-invalid', repeat('b', 64), repeat('c', 64), repeat('d', 64),
         -1, CURRENT_TIMESTAMP
       )`,
      "PersonalDataDeletionAudit_rowCounts_check",
    );

    await assert.rejects(
      client.query(
        `INSERT INTO "CalendarSource" (
           "id", "connectionId", "ownerId", "externalIdMac", "externalIdCiphertext",
           "externalIdIv", "externalIdTag", "externalIdKeyVersion", "nameCiphertext",
           "nameIv", "nameTag", "nameKeyVersion", "updatedAt"
         ) VALUES (
           'source-cross-owner', 'connection-valid', 'calendar-other-owner', repeat('a', 64),
           ${ciphertext}, ${iv}, ${tag}, 1, ${ciphertext}, ${iv}, ${tag}, 1, CURRENT_TIMESTAMP
         )`,
      ),
      /foreign key constraint/,
    );
    await assert.rejects(
      client.query(
        `UPDATE "PersonalDataDeletionAudit" SET "requestMac" = repeat('b', 64) WHERE "id" = 'deletion-audit-valid'`,
      ),
      /append-only/,
    );
    await assert.rejects(
      client.query(
        `DELETE FROM "PersonalDataDeletionAudit" WHERE "id" = 'deletion-audit-valid'`,
      ),
      /append-only/,
    );
    const retainedAudit = await client.query(
      `SELECT count(*)::int AS count FROM "PersonalDataDeletionAudit" WHERE "id" = 'deletion-audit-valid'`,
    );
    assert.equal(retainedAudit.rows[0].count, 1);
  }

  async function assertOwnerConsistency(client) {
    await client.query(
      `INSERT INTO "User" ("id", "email", "updatedAt")
       VALUES ('foreign-owner', 'foreign-owner@example.invalid', CURRENT_TIMESTAMP);
       INSERT INTO "BriefBatch" ("id", "ownerId", "localDate", "timeZone", "updatedAt")
       VALUES
         ('owned-batch', 'upgraded-user', DATE '2026-07-16', 'UTC', CURRENT_TIMESTAMP),
         ('other-batch', 'upgraded-user', DATE '2026-07-17', 'UTC', CURRENT_TIMESTAMP);
       INSERT INTO "BriefItem" (
         "id", "batchId", "ownerId", "kind", "sourceType", "rank", "score",
         "title", "reason", "evidence", "updatedAt"
       ) VALUES (
         'owned-item', 'owned-batch', 'upgraded-user', 'person', 'contact', 1, 50,
         'Synthetic item', 'Synthetic reason', '{}'::jsonb, CURRENT_TIMESTAMP
       );`,
    );

    await assert.rejects(
      client.query(
        `INSERT INTO "BriefItem" (
           "id", "batchId", "ownerId", "kind", "sourceType", "rank", "score",
           "title", "reason", "evidence", "updatedAt"
         ) VALUES (
           'foreign-item', 'owned-batch', 'foreign-owner', 'person', 'contact', 2, 50,
           'Foreign item', 'Synthetic reason', '{}'::jsonb, CURRENT_TIMESTAMP
         )`,
      ),
      /foreign key constraint/,
    );

    await assert.rejects(
      client.query(
        `INSERT INTO "Quest" (
           "id", "batchId", "ownerId", "briefItemId", "title", "completionType",
           "targetId", "xpReward"
         ) VALUES (
           'cross-batch-quest', 'other-batch', 'upgraded-user', 'owned-item',
           'Cross batch quest', 'interaction', 'synthetic-target', 15
         )`,
      ),
      /foreign key constraint/,
    );

    await assert.rejects(
      client.query(
        `INSERT INTO "Quest" (
           "id", "batchId", "ownerId", "briefItemId", "title", "completionType",
           "targetId", "xpReward"
         ) VALUES (
           'foreign-owner-quest', 'owned-batch', 'foreign-owner', 'owned-item',
           'Foreign owner quest', 'interaction', 'synthetic-target', 15
         )`,
      ),
      /foreign key constraint/,
    );

    await client.query(
      `INSERT INTO "Quest" (
         "id", "batchId", "ownerId", "briefItemId", "title", "completionType",
         "targetId", "xpReward"
       ) VALUES (
         'owned-quest', 'owned-batch', 'upgraded-user', 'owned-item',
         'Owned quest', 'interaction', 'synthetic-target', 15
       )`,
    );

    await assert.rejects(
      client.query(
        `INSERT INTO "BriefFeedback" (
           "id", "ownerId", "briefItemId", "action", "idempotencyKey", "requestHash"
         ) VALUES (
           'foreign-item-feedback', 'foreign-owner', 'owned-item', 'accept',
           'foreign-item-key', 'synthetic-hash'
         )`,
      ),
      /foreign key constraint/,
    );

    await assert.rejects(
      client.query(
        `INSERT INTO "BriefFeedback" (
           "id", "ownerId", "questId", "action", "idempotencyKey", "requestHash"
         ) VALUES (
           'foreign-quest-feedback', 'foreign-owner', 'owned-quest', 'complete',
           'foreign-quest-key', 'synthetic-hash'
         )`,
      ),
      /foreign key constraint/,
    );
  }

  async function assertAgentOwnerConsistency(client) {
    await client.query(
      `INSERT INTO "AgentClient" ("id", "ownerId", "name", "scopes", "updatedAt")
       VALUES
         ('agent-client-owned', 'upgraded-user', 'Owned client', ARRAY['contacts:read'], CURRENT_TIMESTAMP),
         ('agent-client-foreign', 'foreign-owner', 'Foreign client', ARRAY['contacts:read'], CURRENT_TIMESTAMP);`,
    );

    await assert.rejects(
      client.query(
        `INSERT INTO "AgentCredential" (
           "id", "ownerId", "clientId", "tokenPrefix", "tokenHash"
         ) VALUES (
           'credential-cross-owner', 'foreign-owner', 'agent-client-owned',
           'credential-cross-owner', repeat('a', 64)
         )`,
      ),
      /foreign key constraint/,
    );
    await client.query(
      `INSERT INTO "AgentCredential" (
         "id", "ownerId", "clientId", "tokenPrefix", "tokenHash"
       ) VALUES (
         'credential-owned', 'upgraded-user', 'agent-client-owned',
         'credential-prefix-owned', repeat('b', 64)
       )`,
    );
    await assert.rejects(
      client.query(
        `INSERT INTO "AgentCredential" (
           "id", "ownerId", "clientId", "tokenPrefix", "tokenHash"
         ) VALUES (
           'credential-duplicate-prefix', 'foreign-owner', 'agent-client-foreign',
           'credential-prefix-owned', repeat('c', 64)
         )`,
      ),
      /unique constraint/,
    );

    await client.query(
      `INSERT INTO "AgentIdempotencyRecord" (
         "id", "ownerId", "clientId", "operation", "idempotencyKey",
         "requestHash", "expiresAt", "updatedAt"
       ) VALUES (
         'idempotency-owned', 'upgraded-user', 'agent-client-owned', 'contacts.search',
         'intent-001', repeat('d', 64), CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP
       )`,
    );
    await assert.rejects(
      client.query(
        `INSERT INTO "AgentIdempotencyRecord" (
           "id", "ownerId", "clientId", "operation", "idempotencyKey",
           "requestHash", "expiresAt", "updatedAt"
         ) VALUES (
           'idempotency-duplicate', 'upgraded-user', 'agent-client-owned', 'contacts.search',
           'intent-001', repeat('e', 64), CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP
         )`,
      ),
      /unique constraint/,
    );

    await client.query(
      `INSERT INTO "ActionProposal" (
         "id", "ownerId", "clientId", "actionType", "riskLevel", "payloadHash",
         "payload", "preview", "expiresAt", "updatedAt"
       ) VALUES (
         'proposal-owned', 'upgraded-user', 'agent-client-owned', 'message', 'approval_required',
         repeat('f', 64), '{}'::jsonb, '{}'::jsonb,
         CURRENT_TIMESTAMP + INTERVAL '1 hour', CURRENT_TIMESTAMP
       )`,
    );
    await assert.rejects(
      client.query(
        `INSERT INTO "ActionProposal" (
           "id", "ownerId", "clientId", "actionType", "riskLevel", "payloadHash",
           "payload", "preview", "expiresAt", "updatedAt"
         ) VALUES (
           'proposal-invalid-risk', 'upgraded-user', 'agent-client-owned', 'message', 'read',
           repeat('1', 64), '{}'::jsonb, '{}'::jsonb,
           CURRENT_TIMESTAMP + INTERVAL '1 hour', CURRENT_TIMESTAMP
         )`,
      ),
      /check constraint/,
    );
    await assert.rejects(
      client.query(
        `INSERT INTO "ApprovalGrant" (
           "id", "ownerId", "clientId", "proposalId", "expiresAt", "updatedAt"
         ) VALUES (
           'grant-cross-owner', 'foreign-owner', 'agent-client-foreign', 'proposal-owned',
           CURRENT_TIMESTAMP + INTERVAL '30 minutes', CURRENT_TIMESTAMP
         )`,
      ),
      /foreign key constraint/,
    );
    await client.query(
      `INSERT INTO "ApprovalGrant" (
         "id", "ownerId", "clientId", "proposalId", "expiresAt", "updatedAt"
       ) VALUES (
         'grant-owned', 'upgraded-user', 'agent-client-owned', 'proposal-owned',
         CURRENT_TIMESTAMP + INTERVAL '30 minutes', CURRENT_TIMESTAMP
       )`,
    );
    await assert.rejects(
      client.query(
        `INSERT INTO "ActionOutbox" (
           "id", "ownerId", "clientId", "grantId", "updatedAt"
         ) VALUES (
           'outbox-cross-owner', 'foreign-owner', 'agent-client-foreign', 'grant-owned',
           CURRENT_TIMESTAMP
         )`,
      ),
      /foreign key constraint/,
    );
    await assert.rejects(
      client.query(
        `INSERT INTO "MutationAuditEvent" (
           "id", "ownerId", "clientId", "operation", "outcome", "metadata"
         ) VALUES (
           'audit-cross-owner', 'foreign-owner', 'agent-client-owned',
           'contacts.search', 'rejected', '{}'::jsonb
         )`,
      ),
      /foreign key constraint/,
    );
    await client.query(
      `INSERT INTO "MutationAuditEvent" (
         "id", "ownerId", "clientId", "operation", "outcome", "metadata"
       ) VALUES (
         'audit-owned', 'upgraded-user', 'agent-client-owned',
         'contacts.search', 'succeeded', '{}'::jsonb
       )`,
    );
    await assert.rejects(
      client.query(
        `UPDATE "MutationAuditEvent" SET "outcome" = 'failed' WHERE "id" = 'audit-owned'`,
      ),
      /append-only/,
    );
    await assert.rejects(
      client.query(
        `DELETE FROM "MutationAuditEvent" WHERE "id" = 'audit-owned'`,
      ),
      /append-only/,
    );
    await assert.rejects(
      client.query(
        `DELETE FROM "AgentClient" WHERE "id" = 'agent-client-owned'`,
      ),
      /foreign key constraint/,
    );
    await assert.rejects(
      client.query(`DELETE FROM "User" WHERE "id" = 'upgraded-user'`),
      /foreign key constraint/,
    );
    const retainedAudit = await client.query(
      `SELECT count(*)::int AS count FROM "MutationAuditEvent" WHERE "id" = 'audit-owned'`,
    );
    assert.equal(retainedAudit.rows[0].count, 1);
  }

  test("reconciliation refuses a populated legacy schema without changing it", async () => {
    await withClient(async (client) => {
      await resetLegacySchema(client);
      await client.query(
        `INSERT INTO "User" ("id", "email", "updatedAt")
         VALUES ('integration-user', 'integration@example.invalid', CURRENT_TIMESTAMP)`,
      );

      await assert.rejects(
        client.query(readFileSync(reconciliationPath, "utf8")),
        /Refusing to convert a populated legacy schema/,
      );
      await client.query("ROLLBACK");

      assert.equal(await columnExists(client, "Contact", "name"), true);
      assert.equal(await columnExists(client, "Contact", "firstName"), false);
      assert.equal(
        await columnExists(client, "DungeonMasterScenario", "id"),
        false,
      );
    });
  });

  test("an injected late migration failure rolls back every reconciliation change", async () => {
    await withClient(async (client) => {
      await resetLegacySchema(client);
      const migration = readFileSync(reconciliationPath, "utf8");
      const injected = migration.replace(
        /\nCOMMIT;\s*$/,
        '\nCREATE TABLE "RollbackProbe" ("id" INTEGER);\nSELECT 1 / 0;\nCOMMIT;\n',
      );
      assert.notEqual(
        injected,
        migration,
        "failure injection point was not found",
      );

      await assert.rejects(client.query(injected), /division by zero/);
      await client.query("ROLLBACK");

      assert.equal(await columnExists(client, "Contact", "name"), true);
      assert.equal(await columnExists(client, "Contact", "firstName"), false);
      assert.equal(await columnExists(client, "RollbackProbe", "id"), false);
      assert.equal(
        await columnExists(client, "DungeonMasterScenario", "id"),
        false,
      );
    });
  });

  test("reconciliation preserves a populated current-shape database", async () => {
    await withClient(async (client) => {
      await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    });
    execFileSync(
      "pnpm",
      [
        "--filter",
        "@socos/api",
        "exec",
        "prisma",
        "db",
        "push",
        "--skip-generate",
      ],
      {
        cwd: root,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "pipe",
      },
    );
    await withClient(async (client) => {
      await client.query(
        'DROP TABLE "DMSceneResponse", "DMSession", "DungeonMasterScenario" CASCADE',
      );
      await client.query(
        `INSERT INTO "User" ("id", "email", "updatedAt")
         VALUES ('current-shape-user', 'current-shape@example.invalid', CURRENT_TIMESTAMP)`,
      );
      await client.query(
        `INSERT INTO "Vault" ("id", "name", "ownerId", "updatedAt")
         VALUES ('current-shape-vault', 'Synthetic vault', 'current-shape-user', CURRENT_TIMESTAMP);
         INSERT INTO "Contact" ("id", "vaultId", "ownerId", "firstName", "bio", "updatedAt")
         VALUES ('current-shape-contact', 'current-shape-vault', 'current-shape-user', 'Synthetic', 'preserve-me', CURRENT_TIMESTAMP);
         INSERT INTO "Interaction" ("id", "contactId", "ownerId", "type", "content", "updatedAt")
         VALUES ('current-shape-interaction', 'current-shape-contact', 'current-shape-user', 'note', 'preserve-interaction', CURRENT_TIMESTAMP);
         INSERT INTO "Reminder" ("id", "contactId", "ownerId", "type", "title", "scheduledAt", "updatedAt")
         VALUES ('current-shape-reminder', 'current-shape-contact', 'current-shape-user', 'followup', 'preserve-reminder', CURRENT_TIMESTAMP + INTERVAL '1 day', CURRENT_TIMESTAMP);`,
      );

      await client.query(readFileSync(reconciliationPath, "utf8"));

      const preserved = await client.query(
        'SELECT count(*)::int AS count FROM "User" WHERE id = $1',
        ["current-shape-user"],
      );
      assert.equal(preserved.rows[0].count, 1);
      const related = await client.query(
        `SELECT
           (SELECT "bio" FROM "Contact" WHERE "id" = 'current-shape-contact') AS bio,
           (SELECT "content" FROM "Interaction" WHERE "id" = 'current-shape-interaction') AS interaction,
           (SELECT "title" FROM "Reminder" WHERE "id" = 'current-shape-reminder') AS reminder`,
      );
      assert.deepEqual(related.rows[0], {
        bio: "preserve-me",
        interaction: "preserve-interaction",
        reminder: "preserve-reminder",
      });
      assert.equal(
        await columnExists(client, "DungeonMasterScenario", "id"),
        true,
      );
    });
  });

  test("upgraded migration deployment adds brief, agent, calendar, and location schemas", async () => {
    await withClient(async (client) => {
      await resetLegacySchema(client);
      for (const path of preBriefMigrationPaths) {
        await client.query(readFileSync(resolve(root, path), "utf8"));
      }

      await client.query(
        `INSERT INTO "User" ("id", "email", "name", "xp", "updatedAt")
         VALUES (
           'upgraded-user', 'upgraded-user@example.invalid', 'Synthetic Owner', 37,
           CURRENT_TIMESTAMP
         );
         INSERT INTO "Vault" ("id", "name", "description", "ownerId", "updatedAt")
         VALUES (
           'upgraded-vault', 'Synthetic Vault', 'preserve-vault', 'upgraded-user',
           CURRENT_TIMESTAMP
         );
         INSERT INTO "Contact" (
           "id", "vaultId", "ownerId", "firstName", "lastName", "bio", "groups",
           "sourceSystem", "sourceId", "updatedAt"
         ) VALUES (
           'upgraded-contact', 'upgraded-vault', 'upgraded-user', 'Synthetic', 'Contact',
           'preserve-contact', ARRAY['Synthetic Group'], 'synthetic', 'source-1',
           CURRENT_TIMESTAMP
         );`,
      );
      const before = await client.query(
        `SELECT
           (SELECT count(*)::int FROM "User") AS "userCount",
           (SELECT count(*)::int FROM "Vault") AS "vaultCount",
           (SELECT count(*)::int FROM "Contact") AS "contactCount",
           (SELECT json_build_object('email', "email", 'name', "name", 'xp', "xp")
              FROM "User" WHERE "id" = 'upgraded-user') AS "userRecord",
           (SELECT json_build_object('name', "name", 'description', "description")
              FROM "Vault" WHERE "id" = 'upgraded-vault') AS "vaultRecord",
           (SELECT json_build_object(
              'firstName', "firstName", 'lastName', "lastName", 'bio', "bio",
              'groups', "groups", 'sourceSystem', "sourceSystem", 'sourceId', "sourceId"
            ) FROM "Contact" WHERE "id" = 'upgraded-contact') AS "contactRecord"`,
      );

      assert.equal(await tableExists(client, "BriefBatch"), false);
      await client.query(readFileSync(dailyBriefMigrationPath, "utf8"));
      await assertDailyBriefSchema(client);
      assert.equal(await tableExists(client, "AgentClient"), false);
      await client.query(readFileSync(agentInterfaceMigrationPath, "utf8"));
      await assertAgentInterfaceSchema(client);
      assert.equal(await tableExists(client, "GoogleOAuthAttempt"), false);
      await client.query(readFileSync(calendarLocationMigrationPath, "utf8"));
      await assertCalendarLocationSchema(client);

      const after = await client.query(
        `SELECT
           (SELECT count(*)::int FROM "User") AS "userCount",
           (SELECT count(*)::int FROM "Vault") AS "vaultCount",
           (SELECT count(*)::int FROM "Contact") AS "contactCount",
           (SELECT json_build_object('email', "email", 'name', "name", 'xp', "xp")
              FROM "User" WHERE "id" = 'upgraded-user') AS "userRecord",
           (SELECT json_build_object('name', "name", 'description', "description")
              FROM "Vault" WHERE "id" = 'upgraded-vault') AS "vaultRecord",
           (SELECT json_build_object(
              'firstName', "firstName", 'lastName', "lastName", 'bio', "bio",
              'groups', "groups", 'sourceSystem', "sourceSystem", 'sourceId', "sourceId"
            ) FROM "Contact" WHERE "id" = 'upgraded-contact') AS "contactRecord"`,
      );
      assert.deepEqual(after.rows[0], before.rows[0]);

      const defaults = await client.query(
        `SELECT
           (SELECT "timeZone" FROM "User" WHERE "id" = 'upgraded-user') AS "timeZone",
           (SELECT "briefHourLocal" FROM "User" WHERE "id" = 'upgraded-user') AS "briefHourLocal",
           (SELECT "importance" FROM "Contact" WHERE "id" = 'upgraded-contact') AS "importance",
           (SELECT "preferredCadenceDays" FROM "Contact"
             WHERE "id" = 'upgraded-contact') AS "preferredCadenceDays"`,
      );
      assert.deepEqual(defaults.rows[0], {
        timeZone: "UTC",
        briefHourLocal: 8,
        importance: 3,
        preferredCadenceDays: 90,
      });
      for (const table of expectedBriefTables) {
        const rows = await client.query(
          `SELECT count(*)::int AS count FROM "${table}"`,
        );
        assert.equal(
          rows.rows[0].count,
          0,
          `${table} must start empty after upgrade`,
        );
      }

      await assertOwnerConsistency(client);
      await assertAgentOwnerConsistency(client);
      await assertCalendarLocationBehavior(client);
    });

    const output = execFileSync("node", ["scripts/compare-schema.mjs"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: "utf8",
    });
    assert.equal(output.trim(), "schema_status=match statements=0");
  });

  test("fresh migration deployment reaches the checked-in Prisma schema", async () => {
    await withClient(async (client) => {
      await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    });
    execFileSync(
      "pnpm",
      ["--filter", "@socos/api", "exec", "prisma", "migrate", "deploy"],
      {
        cwd: root,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "pipe",
      },
    );
    const output = execFileSync("node", ["scripts/compare-schema.mjs"], {
      cwd: root,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: "utf8",
    });
    assert.equal(output.trim(), "schema_status=match statements=0");
    await withClient(assertDailyBriefSchema);
    await withClient(assertAgentInterfaceSchema);
    await withClient(assertCalendarLocationSchema);
    await withClient(assertCalendarLocationBehavior);

    execFileSync(
      "pnpm",
      ["--filter", "@socos/api", "exec", "prisma", "migrate", "deploy"],
      {
        cwd: root,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "pipe",
      },
    );
    await withClient(assertAgentInterfaceSchema);
    await withClient(assertCalendarLocationSchema);
  });
}
