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
const eventDiscoveryMigrationPath = resolve(
  root,
  "services/api/prisma/migrations/20260716160000_event_discovery/migration.sql",
);
const eventBriefSnapshotsMigrationPath = resolve(
  root,
  "services/api/prisma/migrations/20260716170000_event_brief_snapshots/migration.sql",
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
  ["GoogleOAuthAttempt_stateMac_key", "GoogleOAuthAttempt", true, ["stateMac"]],
  [
    "GoogleOAuthAttempt_id_ownerId_key",
    "GoogleOAuthAttempt",
    true,
    ["id", "ownerId"],
  ],
  [
    "GoogleOAuthAttempt_ownerId_expiresAt_consumedAt_idx",
    "GoogleOAuthAttempt",
    false,
    ["ownerId", "expiresAt", "consumedAt"],
  ],
  [
    "GoogleCalendarConnection_ownerId_key",
    "GoogleCalendarConnection",
    true,
    ["ownerId"],
  ],
  [
    "GoogleCalendarConnection_id_ownerId_key",
    "GoogleCalendarConnection",
    true,
    ["id", "ownerId"],
  ],
  [
    "GoogleCalendarConnection_status_calendarListPendingAt_calen_idx",
    "GoogleCalendarConnection",
    false,
    ["status", "calendarListPendingAt", "calendarListLeaseUntil"],
  ],
  [
    "CalendarSource_connectionId_externalIdMac_key",
    "CalendarSource",
    true,
    ["connectionId", "externalIdMac"],
  ],
  ["CalendarSource_id_ownerId_key", "CalendarSource", true, ["id", "ownerId"]],
  [
    "CalendarSource_ownerId_selected_idx",
    "CalendarSource",
    false,
    ["ownerId", "selected"],
  ],
  [
    "CalendarSource_pendingSyncAt_syncLeaseUntil_idx",
    "CalendarSource",
    false,
    ["pendingSyncAt", "syncLeaseUntil"],
  ],
  ["CalendarWatch_channelId_key", "CalendarWatch", true, ["channelId"]],
  ["CalendarWatch_id_ownerId_key", "CalendarWatch", true, ["id", "ownerId"]],
  [
    "CalendarWatch_connectionId_targetType_targetKey_status_idx",
    "CalendarWatch",
    false,
    ["connectionId", "targetType", "targetKey", "status"],
  ],
  [
    "CalendarWatch_status_expiresAt_idx",
    "CalendarWatch",
    false,
    ["status", "expiresAt"],
  ],
  [
    "CalendarEvent_sourceId_externalEventIdMac_key",
    "CalendarEvent",
    true,
    ["sourceId", "externalEventIdMac"],
  ],
  ["CalendarEvent_id_ownerId_key", "CalendarEvent", true, ["id", "ownerId"]],
  [
    "CalendarEvent_ownerId_startAt_endAt_status_idx",
    "CalendarEvent",
    false,
    ["ownerId", "startAt", "endAt", "status"],
  ],
  [
    "CalendarEvent_sourceId_status_idx",
    "CalendarEvent",
    false,
    ["sourceId", "status"],
  ],
  ["LocationDevice_username_key", "LocationDevice", true, ["username"]],
  [
    "LocationDevice_ownerId_nameMac_key",
    "LocationDevice",
    true,
    ["ownerId", "nameMac"],
  ],
  [
    "LocationDevice_ownerId_externalDeviceIdMac_key",
    "LocationDevice",
    true,
    ["ownerId", "externalDeviceIdMac"],
  ],
  ["LocationDevice_id_ownerId_key", "LocationDevice", true, ["id", "ownerId"]],
  [
    "LocationDevice_ownerId_status_idx",
    "LocationDevice",
    false,
    ["ownerId", "status"],
  ],
  [
    "LocationSample_deviceId_payloadMac_key",
    "LocationSample",
    true,
    ["deviceId", "payloadMac"],
  ],
  ["LocationSample_id_ownerId_key", "LocationSample", true, ["id", "ownerId"]],
  [
    "LocationSample_ownerId_recordedAt_idx",
    "LocationSample",
    false,
    ["ownerId", "recordedAt"],
  ],
  [
    "LocationSample_deviceId_recordedAt_idx",
    "LocationSample",
    false,
    ["deviceId", "recordedAt"],
  ],
  [
    "DerivedVisit_deviceId_sourceMac_key",
    "DerivedVisit",
    true,
    ["deviceId", "sourceMac"],
  ],
  ["DerivedVisit_id_ownerId_key", "DerivedVisit", true, ["id", "ownerId"]],
  [
    "DerivedVisit_ownerId_arrivedAt_departedAt_idx",
    "DerivedVisit",
    false,
    ["ownerId", "arrivedAt", "departedAt"],
  ],
  [
    "DerivedVisit_deviceId_arrivedAt_idx",
    "DerivedVisit",
    false,
    ["deviceId", "arrivedAt"],
  ],
  [
    "LocationAlias_ownerId_aliasMac_key",
    "LocationAlias",
    true,
    ["ownerId", "aliasMac"],
  ],
  ["LocationAlias_id_ownerId_key", "LocationAlias", true, ["id", "ownerId"]],
  [
    "LocationAlias_ownerId_city_idx",
    "LocationAlias",
    false,
    ["ownerId", "city"],
  ],
  [
    "CityStay_ownerId_source_sourceId_key",
    "CityStay",
    true,
    ["ownerId", "source", "sourceId"],
  ],
  ["CityStay_id_ownerId_key", "CityStay", true, ["id", "ownerId"]],
  [
    "CityStay_ownerId_startsAt_endsAt_idx",
    "CityStay",
    false,
    ["ownerId", "startsAt", "endsAt"],
  ],
  [
    "PersonalDataDeletionAudit_idempotencyKeyMac_key",
    "PersonalDataDeletionAudit",
    true,
    ["idempotencyKeyMac"],
  ],
  [
    "PersonalDataDeletionAudit_ownerMac_deletedAt_idx",
    "PersonalDataDeletionAudit",
    false,
    ["ownerMac", "deletedAt"],
  ],
];

const expectedCalendarLocationForeignKeys = [
  [
    "GoogleOAuthAttempt_ownerId_fkey",
    "GoogleOAuthAttempt",
    ["ownerId"],
    "User",
    ["id"],
  ],
  [
    "GoogleCalendarConnection_ownerId_fkey",
    "GoogleCalendarConnection",
    ["ownerId"],
    "User",
    ["id"],
  ],
  [
    "CalendarSource_connectionId_ownerId_fkey",
    "CalendarSource",
    ["connectionId", "ownerId"],
    "GoogleCalendarConnection",
    ["id", "ownerId"],
  ],
  [
    "CalendarSource_ownerId_fkey",
    "CalendarSource",
    ["ownerId"],
    "User",
    ["id"],
  ],
  [
    "CalendarWatch_connectionId_ownerId_fkey",
    "CalendarWatch",
    ["connectionId", "ownerId"],
    "GoogleCalendarConnection",
    ["id", "ownerId"],
  ],
  ["CalendarWatch_ownerId_fkey", "CalendarWatch", ["ownerId"], "User", ["id"]],
  [
    "CalendarEvent_sourceId_ownerId_fkey",
    "CalendarEvent",
    ["sourceId", "ownerId"],
    "CalendarSource",
    ["id", "ownerId"],
  ],
  ["CalendarEvent_ownerId_fkey", "CalendarEvent", ["ownerId"], "User", ["id"]],
  [
    "LocationDevice_ownerId_fkey",
    "LocationDevice",
    ["ownerId"],
    "User",
    ["id"],
  ],
  [
    "LocationSample_deviceId_ownerId_fkey",
    "LocationSample",
    ["deviceId", "ownerId"],
    "LocationDevice",
    ["id", "ownerId"],
  ],
  [
    "LocationSample_ownerId_fkey",
    "LocationSample",
    ["ownerId"],
    "User",
    ["id"],
  ],
  [
    "DerivedVisit_deviceId_ownerId_fkey",
    "DerivedVisit",
    ["deviceId", "ownerId"],
    "LocationDevice",
    ["id", "ownerId"],
  ],
  ["DerivedVisit_ownerId_fkey", "DerivedVisit", ["ownerId"], "User", ["id"]],
  ["LocationAlias_ownerId_fkey", "LocationAlias", ["ownerId"], "User", ["id"]],
  ["CityStay_ownerId_fkey", "CityStay", ["ownerId"], "User", ["id"]],
];

const macPredicate = (field, optional = false) =>
  optional
    ? `(("${field}" IS NULL) OR ("${field}" ~ '^[0-9a-f]{64}$'::text))`
    : `("${field}" ~ '^[0-9a-f]{64}$'::text)`;
const requiredEnvelopePredicate = (base) =>
  `(("${base}KeyVersion" > 0) AND (octet_length("${base}Iv") = 12) AND (octet_length("${base}Tag") = 16))`;
const optionalEnvelopePredicate = (base) =>
  `((num_nonnulls("${base}Ciphertext", "${base}Iv", "${base}Tag", "${base}KeyVersion") = ANY (ARRAY[0, 4])) AND (("${base}KeyVersion" IS NULL) OR (("${base}KeyVersion" > 0) AND (octet_length("${base}Iv") = 12) AND (octet_length("${base}Tag") = 16))))`;
const enumPredicate = (field, values) =>
  `(${field} = ANY (ARRAY[${values.map((value) => `'${value}'::text`).join(", ")}]))`;
const maxFiniteDouble =
  "('179769313486231570000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'::numeric)::double precision";

const expectedCalendarLocationCheckPredicates = {
  GoogleOAuthAttempt_stateMac_check: macPredicate("stateMac"),
  GoogleOAuthAttempt_pkceEnvelope_check: requiredEnvelopePredicate("pkce"),
  GoogleCalendarConnection_refreshTokenEnvelope_check:
    requiredEnvelopePredicate("refreshToken"),
  GoogleCalendarConnection_status_check: enumPredicate("status", [
    "active",
    "needs_reauth",
    "disconnected",
  ]),
  GoogleCalendarConnection_calendarListSyncTokenEnvelope_check:
    optionalEnvelopePredicate("calendarListSyncToken"),
  CalendarSource_externalIdMac_check: macPredicate("externalIdMac"),
  CalendarSource_externalIdEnvelope_check:
    requiredEnvelopePredicate("externalId"),
  CalendarSource_nameEnvelope_check: requiredEnvelopePredicate("name"),
  CalendarSource_syncTokenEnvelope_check:
    optionalEnvelopePredicate("syncToken"),
  CalendarWatch_targetType_check: enumPredicate('"targetType"', [
    "calendar_list",
    "events",
  ]),
  CalendarWatch_status_check: enumPredicate("status", ["active", "stopping"]),
  CalendarWatch_resourceIdMac_check: macPredicate("resourceIdMac"),
  CalendarWatch_resourceIdEnvelope_check:
    requiredEnvelopePredicate("resourceId"),
  CalendarWatch_tokenMac_check: macPredicate("tokenMac"),
  CalendarEvent_externalEventIdMac_check: macPredicate("externalEventIdMac"),
  CalendarEvent_externalEventIdEnvelope_check:
    requiredEnvelopePredicate("externalEventId"),
  CalendarEvent_status_check: enumPredicate("status", [
    "confirmed",
    "tentative",
    "cancelled",
  ]),
  CalendarEvent_transparency_check: enumPredicate("transparency", [
    "opaque",
    "transparent",
  ]),
  CalendarEvent_recurringEventIdMac_check: macPredicate(
    "recurringEventIdMac",
    true,
  ),
  CalendarEvent_recurringEventIdEnvelope_check:
    optionalEnvelopePredicate("recurringEventId"),
  CalendarEvent_detailsEnvelope_check: optionalEnvelopePredicate("details"),
  CalendarEvent_timing_check: `(((("startAt" IS NULL) AND ("endAt" IS NULL) AND (status = 'cancelled'::text)) OR (("startAt" IS NOT NULL) AND ("endAt" IS NOT NULL) AND ("endAt" > "startAt"))) AND ((status = 'cancelled'::text) OR ("detailsCiphertext" IS NOT NULL)))`,
  CalendarEvent_allDay_check: `(("allDay" AND ("startDate" IS NOT NULL) AND ("endDate" IS NOT NULL) AND ("endDate" > "startDate")) OR ((NOT "allDay") AND ("startDate" IS NULL) AND ("endDate" IS NULL)))`,
  LocationDevice_nameMac_check: macPredicate("nameMac"),
  LocationDevice_nameEnvelope_check: requiredEnvelopePredicate("name"),
  LocationDevice_username_check: `(username ~ '^[A-Za-z0-9_-]{32}$'::text)`,
  LocationDevice_credentialHash_check: `("credentialHash" ~ '^scrypt[$]32768[$]8[$]1[$][A-Za-z0-9_-]{22}[$][A-Za-z0-9_-]{43}$'::text)`,
  LocationDevice_externalDeviceIdMac_check: macPredicate("externalDeviceIdMac"),
  LocationDevice_externalDeviceIdEnvelope_check:
    requiredEnvelopePredicate("externalDeviceId"),
  LocationDevice_status_check: enumPredicate("status", ["active", "revoked"]),
  LocationDevice_rawRetentionDays_check: `(("rawRetentionDays" >= 30) AND ("rawRetentionDays" <= 365))`,
  LocationDevice_derivedRetentionDays_check: `(("derivedRetentionDays" >= 90) AND ("derivedRetentionDays" <= 3650))`,
  LocationSample_coordinatesEnvelope_check:
    requiredEnvelopePredicate("coordinates"),
  LocationSample_accuracyM_check: `(("accuracyM" IS NULL) OR (("accuracyM" >= (0)::double precision) AND ("accuracyM" <= ${maxFiniteDouble})))`,
  LocationSample_batteryPercent_check: `(("batteryPercent" IS NULL) OR (("batteryPercent" >= 0) AND ("batteryPercent" <= 100)))`,
  LocationSample_payloadMac_check: macPredicate("payloadMac"),
  DerivedVisit_centroidEnvelope_check: requiredEnvelopePredicate("centroid"),
  DerivedVisit_radiusM_check: `(("radiusM" >= (0)::double precision) AND ("radiusM" <= ${maxFiniteDouble}))`,
  DerivedVisit_confidence_check: `((confidence >= (0)::double precision) AND (confidence <= (1)::double precision))`,
  DerivedVisit_sourceMac_check: macPredicate("sourceMac"),
  DerivedVisit_timeRange_check: `(("departedAt" IS NULL) OR ("departedAt" > "arrivedAt"))`,
  LocationAlias_aliasMac_check: macPredicate("aliasMac"),
  LocationAlias_aliasEnvelope_check: requiredEnvelopePredicate("alias"),
  CityStay_source_check: `(source = 'calendar'::text)`,
  CityStay_confidence_check: `((confidence >= (0)::double precision) AND (confidence <= (1)::double precision))`,
  CityStay_timeRange_check: `(("endsAt" IS NULL) OR ("endsAt" > "startsAt"))`,
  PersonalDataDeletionAudit_ownerMac_check: macPredicate("ownerMac"),
  PersonalDataDeletionAudit_idempotencyKeyMac_check:
    macPredicate("idempotencyKeyMac"),
  PersonalDataDeletionAudit_requestMac_check: macPredicate("requestMac"),
  PersonalDataDeletionAudit_rowCounts_check: `(("calendarRowCount" >= 0) AND ("locationRowCount" >= 0) AND ("eventRowCount" >= 0))`,
};
const expectedCalendarLocationChecks = Object.keys(
  expectedCalendarLocationCheckPredicates,
);

const expectedEventDiscoveryColumns = {
  EventPreference: [
    ["id", "text", "NO"],
    ["ownerId", "text", "NO"],
    ["interestTagsCiphertext", "bytea", "NO"],
    ["interestTagsIv", "bytea", "NO"],
    ["interestTagsTag", "bytea", "NO"],
    ["interestTagsKeyVersion", "integer", "NO"],
    ["maxDistanceKm", "numeric", "NO", "50", 6, 2],
    ["travelSpeedKph", "integer", "NO", "30"],
    ["travelBufferMinutes", "integer", "NO", "15"],
    ["createdAt", "timestamp without time zone", "NO", "CURRENT_TIMESTAMP"],
    ["updatedAt", "timestamp without time zone", "NO"],
  ],
  EventSource: [
    ["id", "text", "NO"],
    ["ownerId", "text", "NO"],
    ["provider", "text", "NO", "'ics'::text"],
    ["externalSourceId", "text", "NO"],
    ["name", "text", "NO"],
    ["feedUrlMac", "text", "NO"],
    ["feedUrlCiphertext", "bytea", "NO"],
    ["feedUrlIv", "bytea", "NO"],
    ["feedUrlTag", "bytea", "NO"],
    ["feedUrlKeyVersion", "integer", "NO"],
    ["allowedHost", "text", "NO"],
    ["city", "text", "YES"],
    ["countryCode", "text", "YES"],
    ["socialWeight", "integer", "NO", "5"],
    ["status", "text", "NO", "'active'::text"],
    ["pollIntervalMinutes", "integer", "NO", "60"],
    ["nextPollAt", "timestamp without time zone", "NO"],
    ["leaseUntil", "timestamp without time zone", "YES"],
    ["lastPolledAt", "timestamp without time zone", "YES"],
    ["errorCode", "text", "YES"],
    ["createdAt", "timestamp without time zone", "NO", "CURRENT_TIMESTAMP"],
    ["updatedAt", "timestamp without time zone", "NO"],
  ],
  DiscoveredEvent: [
    ["id", "text", "NO"],
    ["ownerId", "text", "NO"],
    ["sourceId", "text", "NO"],
    ["providerEventIdMac", "text", "NO"],
    ["providerEventIdCiphertext", "bytea", "NO"],
    ["providerEventIdIv", "bytea", "NO"],
    ["providerEventIdTag", "bytea", "NO"],
    ["providerEventIdKeyVersion", "integer", "NO"],
    ["canonicalMac", "text", "NO"],
    ["title", "text", "NO"],
    ["descriptionExcerpt", "text", "YES"],
    ["url", "text", "YES"],
    ["startAt", "timestamp without time zone", "NO"],
    ["endAt", "timestamp without time zone", "NO"],
    ["timeZone", "text", "YES"],
    ["venueName", "text", "YES"],
    ["address", "text", "YES"],
    ["city", "text", "YES"],
    ["countryCode", "text", "YES"],
    ["latitude", "numeric", "YES", undefined, 9, 6],
    ["longitude", "numeric", "YES", undefined, 9, 6],
    ["category", "text", "YES"],
    ["tags", "ARRAY", "NO", "ARRAY[]::text[]"],
    ["status", "text", "NO", "'scheduled'::text"],
    ["sourceUpdatedAt", "timestamp without time zone", "YES"],
    ["discoveredAt", "timestamp without time zone", "NO", "CURRENT_TIMESTAMP"],
    ["expiresAt", "timestamp without time zone", "NO"],
    ["createdAt", "timestamp without time zone", "NO", "CURRENT_TIMESTAMP"],
    ["updatedAt", "timestamp without time zone", "NO"],
  ],
};

const expectedEventDiscoveryIndexes = [
  ["EventPreference_ownerId_key", "EventPreference", true, ["ownerId"]],
  [
    "EventPreference_id_ownerId_key",
    "EventPreference",
    true,
    ["id", "ownerId"],
  ],
  [
    "EventSource_ownerId_provider_externalSourceId_key",
    "EventSource",
    true,
    ["ownerId", "provider", "externalSourceId"],
  ],
  [
    "EventSource_ownerId_feedUrlMac_key",
    "EventSource",
    true,
    ["ownerId", "feedUrlMac"],
  ],
  ["EventSource_id_ownerId_key", "EventSource", true, ["id", "ownerId"]],
  [
    "EventSource_status_nextPollAt_leaseUntil_idx",
    "EventSource",
    false,
    ["status", "nextPollAt", "leaseUntil"],
  ],
  [
    "DiscoveredEvent_sourceId_providerEventIdMac_key",
    "DiscoveredEvent",
    true,
    ["sourceId", "providerEventIdMac"],
  ],
  [
    "DiscoveredEvent_id_ownerId_key",
    "DiscoveredEvent",
    true,
    ["id", "ownerId"],
  ],
  [
    "DiscoveredEvent_ownerId_startAt_status_city_idx",
    "DiscoveredEvent",
    false,
    ["ownerId", "startAt", "status", "city"],
  ],
  [
    "DiscoveredEvent_sourceId_canonicalMac_idx",
    "DiscoveredEvent",
    false,
    ["sourceId", "canonicalMac"],
  ],
];

const expectedEventDiscoveryForeignKeys = [
  [
    "EventPreference_ownerId_fkey",
    "EventPreference",
    ["ownerId"],
    "User",
    ["id"],
  ],
  ["EventSource_ownerId_fkey", "EventSource", ["ownerId"], "User", ["id"]],
  [
    "DiscoveredEvent_ownerId_fkey",
    "DiscoveredEvent",
    ["ownerId"],
    "User",
    ["id"],
  ],
  [
    "DiscoveredEvent_sourceId_ownerId_fkey",
    "DiscoveredEvent",
    ["sourceId", "ownerId"],
    "EventSource",
    ["id", "ownerId"],
  ],
];

const expectedEventDiscoveryCheckPredicates = {
  EventPreference_interestTagsEnvelope_check:
    requiredEnvelopePredicate("interestTags"),
  EventPreference_maxDistanceKm_check: `(("maxDistanceKm" >= (1)::numeric) AND ("maxDistanceKm" <= (500)::numeric))`,
  EventPreference_travelSpeedKph_check: `(("travelSpeedKph" >= 1) AND ("travelSpeedKph" <= 300))`,
  EventPreference_travelBufferMinutes_check: `(("travelBufferMinutes" >= 0) AND ("travelBufferMinutes" <= 240))`,
  EventSource_provider_check: `(provider = 'ics'::text)`,
  EventSource_feedUrlMac_check: macPredicate("feedUrlMac"),
  EventSource_feedUrlEnvelope_check: requiredEnvelopePredicate("feedUrl"),
  EventSource_countryCode_check: `(("countryCode" IS NULL) OR ("countryCode" ~ '^[A-Z]{2}$'::text))`,
  EventSource_socialWeight_check: `(("socialWeight" >= 0) AND ("socialWeight" <= 10))`,
  EventSource_status_check: enumPredicate("status", [
    "active",
    "disabled",
    "error",
  ]),
  EventSource_pollIntervalMinutes_check: `(("pollIntervalMinutes" >= 15) AND ("pollIntervalMinutes" <= 1440))`,
  DiscoveredEvent_providerEventIdMac_check: macPredicate("providerEventIdMac"),
  DiscoveredEvent_providerEventIdEnvelope_check:
    requiredEnvelopePredicate("providerEventId"),
  DiscoveredEvent_canonicalMac_check: macPredicate("canonicalMac"),
  DiscoveredEvent_countryCode_check: `(("countryCode" IS NULL) OR ("countryCode" ~ '^[A-Z]{2}$'::text))`,
  DiscoveredEvent_status_check: enumPredicate("status", [
    "scheduled",
    "cancelled",
    "expired",
  ]),
  DiscoveredEvent_timeRange_check: `("endAt" > "startAt")`,
  DiscoveredEvent_coordinates_check: `(((latitude IS NULL) AND (longitude IS NULL)) OR ((latitude IS NOT NULL) AND (longitude IS NOT NULL) AND ((latitude >= ('-90'::integer)::numeric) AND (latitude <= (90)::numeric)) AND ((longitude >= ('-180'::integer)::numeric) AND (longitude <= (180)::numeric))))`,
};
const expectedEventDiscoveryChecks = Object.keys(
  expectedEventDiscoveryCheckPredicates,
);
const expectedEventBriefSnapshotColumns = [
  ["eventStartAt", "timestamp without time zone", "YES", "DateTime"],
  ["eventEndAt", "timestamp without time zone", "YES", "DateTime"],
  ["eventCity", "text", "YES", "String"],
];
const expectedEventBriefSnapshotChecks = [
  "BriefItem_eventSnapshotTime_check",
  "BriefItem_eventSnapshotKind_check",
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

test("event discovery schema declares the exact public and encrypted persistence boundary", () => {
  const schema = readFileSync(
    resolve(root, "services/api/prisma/schema.prisma"),
    "utf8",
  );
  assert.equal(
    existsSync(eventDiscoveryMigrationPath),
    true,
    "event discovery migration file is missing",
  );
  const migration = existsSync(eventDiscoveryMigrationPath)
    ? readFileSync(eventDiscoveryMigrationPath, "utf8")
    : "";

  assert.match(migration, /^BEGIN;\n[\s\S]*\nCOMMIT;\n?$/);
  assert.equal(migration.match(/^BEGIN;$/gm)?.length, 1);
  assert.equal(migration.match(/^COMMIT;$/gm)?.length, 1);

  for (const table of Object.keys(expectedEventDiscoveryColumns)) {
    assert.match(schema, new RegExp(`model ${table} \\{`));
    assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
  }
  for (const check of expectedEventDiscoveryChecks) {
    assert.match(
      migration,
      new RegExp(`CONSTRAINT "${check}" CHECK`),
      `missing named check ${check}`,
    );
  }
  assert.doesNotMatch(
    migration,
    /"(?:interestTags|feedUrl|providerEventId)Ciphertext"\s+BYTEA\s+(?:DEFAULT|NULL)/,
  );
  assert.doesNotMatch(migration, /"(?:id|updatedAt)"[^,\n]+DEFAULT/);
});

test("event brief snapshot schema declares public event time and coarse city snapshots", () => {
  const schema = readFileSync(
    resolve(root, "services/api/prisma/schema.prisma"),
    "utf8",
  );
  assert.equal(
    existsSync(eventBriefSnapshotsMigrationPath),
    true,
    "event brief snapshots migration file is missing",
  );
  const migration = existsSync(eventBriefSnapshotsMigrationPath)
    ? readFileSync(eventBriefSnapshotsMigrationPath, "utf8")
    : "";

  for (const [column, , , prismaType] of expectedEventBriefSnapshotColumns) {
    assert.match(schema, new RegExp(`\\s${column}\\s+${prismaType}\\?`));
    if (prismaType === "DateTime") {
      assert.match(migration, new RegExp(`"${column}" TIMESTAMP\\(3\\)`));
    }
  }
  assert.match(migration, /"eventCity" TEXT/);
  assert.match(
    migration,
    /CONSTRAINT "BriefItem_eventSnapshotTime_check" CHECK/,
  );
  assert.match(
    migration,
    /"eventEndAt" > "eventStartAt"/,
  );
  assert.match(
    migration,
    /CONSTRAINT "BriefItem_eventSnapshotKind_check" CHECK/,
  );
  assert.match(
    migration,
    /"kind" = 'event'[\s\S]*"eventStartAt" IS NOT NULL[\s\S]*"eventEndAt" IS NOT NULL/,
  );
  assert.match(
    migration,
    /"kind" <> 'event'[\s\S]*"eventStartAt" IS NULL[\s\S]*"eventEndAt" IS NULL[\s\S]*"eventCity" IS NULL/,
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

  async function assertEventBriefSnapshotSchema(client) {
    const columns = await client.query(
      `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'BriefItem'
          AND column_name = ANY($1::text[])
        ORDER BY column_name`,
      [expectedEventBriefSnapshotColumns.map(([name]) => name)],
    );
    assert.deepEqual(
      columns.rows.map((row) => [
        row.column_name,
        row.data_type,
        row.is_nullable,
      ]),
      [...expectedEventBriefSnapshotColumns]
        .map(([column, type, nullable]) => [column, type, nullable])
        .sort((left, right) => left[0].localeCompare(right[0])),
    );

    const checks = await client.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conname = ANY($1::text[])`,
      [expectedEventBriefSnapshotChecks],
    );
    assert.deepEqual(
      checks.rows.map(({ conname }) => conname).sort(),
      [...expectedEventBriefSnapshotChecks].sort(),
    );
    const definitions = new Map(
      checks.rows.map(({ conname, definition }) => [
        conname,
        definition.replaceAll('"', ""),
      ]),
    );
    assert.match(
      definitions.get("BriefItem_eventSnapshotTime_check") ?? "",
      /eventStartAt IS NULL.+eventEndAt IS NULL.+eventStartAt IS NOT NULL.+eventEndAt IS NOT NULL.+eventEndAt > eventStartAt/,
    );
    assert.match(
      definitions.get("BriefItem_eventSnapshotKind_check") ?? "",
      /kind = 'event'.+eventStartAt IS NOT NULL.+eventEndAt IS NOT NULL.+kind <> 'event'.+eventStartAt IS NULL.+eventEndAt IS NULL.+eventCity IS NULL/,
    );
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

    const expectedPrimaryKeys = tables
      .map((table) => ({
        name: `${table}_pkey`,
        table,
        columns: ["id"],
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const primaryKeys = await client.query(
      `SELECT c.conname AS name, t.relname AS table,
              ARRAY(
                SELECT a.attname
                  FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, position)
                  JOIN pg_attribute a
                    ON a.attrelid = c.conrelid AND a.attnum = key.attnum
                 ORDER BY key.position
              )::text[] AS columns
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND c.contype = 'p'
          AND t.relname = ANY($1::text[])
        ORDER BY c.conname`,
      [tables],
    );
    assert.deepEqual(
      primaryKeys.rows,
      expectedPrimaryKeys,
      "calendar/location primary keys differ from the contract",
    );

    const expectedIndexes = [
      ...expectedPrimaryKeys.map(({ name, table, columns }) => ({
        name,
        table,
        unique: true,
        primary: true,
        columns,
      })),
      ...expectedCalendarLocationIndexes.map(
        ([name, table, unique, columns]) => ({
          name,
          table,
          unique,
          primary: false,
          columns,
        }),
      ),
    ].sort((left, right) => left.name.localeCompare(right.name));
    const indexes = await client.query(
      `SELECT idx.relname AS name, t.relname AS table,
              i.indisunique AS unique, i.indisprimary AS primary,
              ARRAY(
                SELECT a.attname
                  FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, position)
                  JOIN pg_attribute a
                    ON a.attrelid = i.indrelid AND a.attnum = key.attnum
                 WHERE key.position <= i.indnkeyatts
                 ORDER BY key.position
              )::text[] AS columns
         FROM pg_index i
         JOIN pg_class idx ON idx.oid = i.indexrelid
         JOIN pg_class t ON t.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = ANY($1::text[])
        ORDER BY idx.relname`,
      [tables],
    );
    assert.deepEqual(
      indexes.rows,
      expectedIndexes,
      "calendar/location index catalog differs from the contract",
    );
    const forbiddenWatchUnique = await client.query(
      `SELECT count(*)::int AS count FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'CalendarWatch'
          AND indexdef LIKE 'CREATE UNIQUE INDEX%'
          AND indexdef LIKE '%("connectionId", "targetType", "targetKey")%'`,
    );
    assert.equal(forbiddenWatchUnique.rows[0].count, 0);

    const checks = await client.query(
      `SELECT c.conname AS name, t.relname AS table,
              pg_get_expr(c.conbin, c.conrelid, false) AS predicate
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND c.contype = 'c'
          AND t.relname = ANY($1::text[])
        ORDER BY c.conname`,
      [tables],
    );
    const expectedChecks = Object.entries(
      expectedCalendarLocationCheckPredicates,
    )
      .map(([name, predicate]) => ({
        name,
        table: name.slice(0, name.indexOf("_")),
        predicate,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    assert.deepEqual(
      checks.rows,
      expectedChecks,
      "calendar/location check catalog differs from the exact canonical predicates",
    );

    const foreignKeys = await client.query(
      `SELECT c.conname AS name, t.relname AS table,
              ARRAY(
                SELECT a.attname
                  FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, position)
                  JOIN pg_attribute a
                    ON a.attrelid = c.conrelid AND a.attnum = key.attnum
                 ORDER BY key.position
              )::text[] AS columns,
              rt.relname AS "referencedTable",
              ARRAY(
                SELECT a.attname
                  FROM unnest(c.confkey) WITH ORDINALITY AS key(attnum, position)
                  JOIN pg_attribute a
                    ON a.attrelid = c.confrelid AND a.attnum = key.attnum
                 ORDER BY key.position
              )::text[] AS "referencedColumns",
              CASE c.confdeltype WHEN 'c' THEN 'CASCADE' ELSE c.confdeltype::text END AS "deleteAction",
              CASE c.confupdtype WHEN 'c' THEN 'CASCADE' ELSE c.confupdtype::text END AS "updateAction"
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_class rt ON rt.oid = c.confrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND c.contype = 'f'
          AND t.relname = ANY($1::text[])
        ORDER BY c.conname`,
      [tables],
    );
    const expectedForeignKeys = expectedCalendarLocationForeignKeys
      .map(([name, table, columns, referencedTable, referencedColumns]) => ({
        name,
        table,
        columns,
        referencedTable,
        referencedColumns,
        deleteAction: "CASCADE",
        updateAction: "CASCADE",
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    assert.deepEqual(
      foreignKeys.rows,
      expectedForeignKeys,
      "calendar/location foreign-key catalog differs from the contract",
    );

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

  async function assertEventDiscoverySchema(client) {
    const tables = Object.keys(expectedEventDiscoveryColumns);
    for (const table of tables) {
      assert.equal(
        await tableExists(client, table),
        true,
        `missing table ${table}`,
      );
      const result = await client.query(
        `SELECT column_name, data_type, udt_name, is_nullable, column_default,
                datetime_precision, numeric_precision, numeric_scale
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position`,
        [table],
      );
      const expected = expectedEventDiscoveryColumns[table];
      assert.deepEqual(
        result.rows.map(({ column_name }) => column_name),
        expected.map(([name]) => name),
        `${table} columns differ from the contract`,
      );
      for (const [
        name,
        type,
        nullable,
        expectedDefault,
        numericPrecision,
        numericScale,
      ] of expected) {
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
        if (type === "numeric") {
          assert.equal(
            column?.numeric_precision,
            numericPrecision,
            `${table}.${name} has the wrong numeric precision`,
          );
          assert.equal(
            column?.numeric_scale,
            numericScale,
            `${table}.${name} has the wrong numeric scale`,
          );
        }
        if (expectedDefault !== undefined) {
          assert.equal(
            column?.column_default,
            expectedDefault,
            `${table}.${name} has the wrong exact default`,
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

    const expectedPrimaryKeys = tables
      .map((table) => ({ name: `${table}_pkey`, table, columns: ["id"] }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const primaryKeys = await client.query(
      `SELECT c.conname AS name, t.relname AS table,
              ARRAY(
                SELECT a.attname
                  FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, position)
                  JOIN pg_attribute a
                    ON a.attrelid = c.conrelid AND a.attnum = key.attnum
                 ORDER BY key.position
              )::text[] AS columns
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND c.contype = 'p'
          AND t.relname = ANY($1::text[])
        ORDER BY c.conname`,
      [tables],
    );
    assert.deepEqual(primaryKeys.rows, expectedPrimaryKeys);

    const expectedIndexes = [
      ...expectedPrimaryKeys.map(({ name, table, columns }) => ({
        name,
        table,
        unique: true,
        primary: true,
        columns,
      })),
      ...expectedEventDiscoveryIndexes.map(
        ([name, table, unique, columns]) => ({
          name,
          table,
          unique,
          primary: false,
          columns,
        }),
      ),
    ].sort((left, right) => left.name.localeCompare(right.name));
    const indexes = await client.query(
      `SELECT idx.relname AS name, t.relname AS table,
              i.indisunique AS unique, i.indisprimary AS primary,
              ARRAY(
                SELECT a.attname
                  FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, position)
                  JOIN pg_attribute a
                    ON a.attrelid = i.indrelid AND a.attnum = key.attnum
                 WHERE key.position <= i.indnkeyatts
                 ORDER BY key.position
              )::text[] AS columns
         FROM pg_index i
         JOIN pg_class idx ON idx.oid = i.indexrelid
         JOIN pg_class t ON t.oid = i.indrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = ANY($1::text[])
        ORDER BY idx.relname`,
      [tables],
    );
    assert.deepEqual(
      indexes.rows,
      expectedIndexes,
      "event discovery index catalog differs from the contract",
    );

    const checks = await client.query(
      `SELECT c.conname AS name, t.relname AS table,
              pg_get_expr(c.conbin, c.conrelid, false) AS predicate
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND c.contype = 'c'
          AND t.relname = ANY($1::text[])
        ORDER BY c.conname`,
      [tables],
    );
    const expectedChecks = Object.entries(expectedEventDiscoveryCheckPredicates)
      .map(([name, predicate]) => ({
        name,
        table: name.slice(0, name.indexOf("_")),
        predicate,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    assert.deepEqual(
      checks.rows,
      expectedChecks,
      "event discovery check catalog differs from the exact canonical predicates",
    );

    const foreignKeys = await client.query(
      `SELECT c.conname AS name, t.relname AS table,
              ARRAY(
                SELECT a.attname
                  FROM unnest(c.conkey) WITH ORDINALITY AS key(attnum, position)
                  JOIN pg_attribute a
                    ON a.attrelid = c.conrelid AND a.attnum = key.attnum
                 ORDER BY key.position
              )::text[] AS columns,
              rt.relname AS "referencedTable",
              ARRAY(
                SELECT a.attname
                  FROM unnest(c.confkey) WITH ORDINALITY AS key(attnum, position)
                  JOIN pg_attribute a
                    ON a.attrelid = c.confrelid AND a.attnum = key.attnum
                 ORDER BY key.position
              )::text[] AS "referencedColumns",
              CASE c.confdeltype WHEN 'c' THEN 'CASCADE' ELSE c.confdeltype::text END AS "deleteAction",
              CASE c.confupdtype WHEN 'c' THEN 'CASCADE' ELSE c.confupdtype::text END AS "updateAction"
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_class rt ON rt.oid = c.confrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND c.contype = 'f'
          AND t.relname = ANY($1::text[])
        ORDER BY c.conname`,
      [tables],
    );
    const expectedForeignKeys = expectedEventDiscoveryForeignKeys
      .map(([name, table, columns, referencedTable, referencedColumns]) => ({
        name,
        table,
        columns,
        referencedTable,
        referencedColumns,
        deleteAction: "CASCADE",
        updateAction: "CASCADE",
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    assert.deepEqual(
      foreignKeys.rows,
      expectedForeignKeys,
      "event discovery foreign-key catalog differs from the contract",
    );
  }

  async function assertEventDiscoveryBehavior(client) {
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
         ('event-owner', 'event-owner@example.invalid', CURRENT_TIMESTAMP),
         ('event-other-owner', 'event-other-owner@example.invalid', CURRENT_TIMESTAMP),
         ('event-default-owner', 'event-default-owner@example.invalid', CURRENT_TIMESTAMP);
       INSERT INTO "EventPreference" (
         "id", "ownerId", "interestTagsCiphertext", "interestTagsIv",
         "interestTagsTag", "interestTagsKeyVersion", "maxDistanceKm", "updatedAt"
       ) VALUES (
         'preference-valid', 'event-owner', ${ciphertext}, ${iv}, ${tag}, 1, 1,
         CURRENT_TIMESTAMP
       );
       INSERT INTO "EventPreference" (
         "id", "ownerId", "interestTagsCiphertext", "interestTagsIv",
         "interestTagsTag", "interestTagsKeyVersion", "updatedAt"
       ) VALUES (
         'preference-default', 'event-default-owner', ${ciphertext}, ${iv}, ${tag}, 1,
         CURRENT_TIMESTAMP
       );
       INSERT INTO "EventSource" (
         "id", "ownerId", "externalSourceId", "name", "feedUrlMac",
         "feedUrlCiphertext", "feedUrlIv", "feedUrlTag", "feedUrlKeyVersion",
         "allowedHost", "countryCode", "socialWeight", "pollIntervalMinutes",
         "nextPollAt", "updatedAt"
       ) VALUES (
         'event-source-valid', 'event-owner', 'source-uuid', 'Synthetic events',
         repeat('a', 64), ${ciphertext}, ${iv}, ${tag}, 1, 'events.example.invalid',
         'AE', 0, 15, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       );
       INSERT INTO "EventSource" (
         "id", "ownerId", "externalSourceId", "name", "feedUrlMac",
         "feedUrlCiphertext", "feedUrlIv", "feedUrlTag", "feedUrlKeyVersion",
         "allowedHost", "nextPollAt", "updatedAt"
       ) VALUES (
         'event-source-default', 'event-default-owner', 'source-default-uuid',
         'Default synthetic events', repeat('d', 64), ${ciphertext}, ${iv}, ${tag}, 1,
         'default-events.example.invalid', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       );
       INSERT INTO "DiscoveredEvent" (
         "id", "ownerId", "sourceId", "providerEventIdMac",
         "providerEventIdCiphertext", "providerEventIdIv", "providerEventIdTag",
         "providerEventIdKeyVersion", "canonicalMac", "title", "startAt", "endAt",
         "countryCode", "latitude", "longitude", "expiresAt", "updatedAt"
       ) VALUES (
         'discovered-event-valid', 'event-owner', 'event-source-valid', repeat('b', 64),
         ${ciphertext}, ${iv}, ${tag}, 1, repeat('c', 64), 'Synthetic event',
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 hour', 'US', 90, -180,
         CURRENT_TIMESTAMP + INTERVAL '14 days', CURRENT_TIMESTAMP
       );
       INSERT INTO "DiscoveredEvent" (
         "id", "ownerId", "sourceId", "providerEventIdMac",
         "providerEventIdCiphertext", "providerEventIdIv", "providerEventIdTag",
         "providerEventIdKeyVersion", "canonicalMac", "title", "startAt", "endAt",
         "expiresAt", "updatedAt"
       ) VALUES (
         'discovered-event-default', 'event-default-owner', 'event-source-default',
         repeat('e', 64), ${ciphertext}, ${iv}, ${tag}, 1, repeat('f', 64),
         'Default synthetic event', CURRENT_TIMESTAMP,
         CURRENT_TIMESTAMP + INTERVAL '1 hour', CURRENT_TIMESTAMP + INTERVAL '14 days',
         CURRENT_TIMESTAMP
       );`,
    );

    const defaults = await client.query(
      `SELECT
         (SELECT json_build_object(
           'distance', "maxDistanceKm", 'speed', "travelSpeedKph",
           'buffer', "travelBufferMinutes", 'created', "createdAt" IS NOT NULL
         ) FROM "EventPreference" WHERE "id" = 'preference-default') AS preference,
         (SELECT json_build_object(
           'provider', "provider", 'social', "socialWeight", 'status', "status",
           'poll', "pollIntervalMinutes", 'created', "createdAt" IS NOT NULL
         ) FROM "EventSource" WHERE "id" = 'event-source-default') AS source,
         (SELECT json_build_object(
           'status', "status", 'tags', "tags",
           'discovered', "discoveredAt" IS NOT NULL, 'created', "createdAt" IS NOT NULL
         ) FROM "DiscoveredEvent" WHERE "id" = 'discovered-event-default') AS event`,
    );
    assert.deepEqual(defaults.rows[0], {
      preference: { distance: 50, speed: 30, buffer: 15, created: true },
      source: {
        provider: "ics",
        social: 5,
        status: "active",
        poll: 60,
        created: true,
      },
      event: { status: "scheduled", tags: [], discovered: true, created: true },
    });

    await expectConstraint(
      `UPDATE "EventPreference" SET "interestTagsIv" = decode('00', 'hex') WHERE "id" = 'preference-valid'`,
      "EventPreference_interestTagsEnvelope_check",
    );
    await expectConstraint(
      `UPDATE "EventPreference" SET "maxDistanceKm" = 500.01 WHERE "id" = 'preference-valid'`,
      "EventPreference_maxDistanceKm_check",
    );
    await expectConstraint(
      `UPDATE "EventPreference" SET "travelSpeedKph" = 301 WHERE "id" = 'preference-valid'`,
      "EventPreference_travelSpeedKph_check",
    );
    await expectConstraint(
      `UPDATE "EventPreference" SET "travelBufferMinutes" = -1 WHERE "id" = 'preference-valid'`,
      "EventPreference_travelBufferMinutes_check",
    );
    await expectConstraint(
      `UPDATE "EventSource" SET "provider" = 'private-api' WHERE "id" = 'event-source-valid'`,
      "EventSource_provider_check",
    );
    await expectConstraint(
      `UPDATE "EventSource" SET "feedUrlMac" = 'ABC' WHERE "id" = 'event-source-valid'`,
      "EventSource_feedUrlMac_check",
    );
    await expectConstraint(
      `UPDATE "EventSource" SET "feedUrlTag" = decode('00', 'hex') WHERE "id" = 'event-source-valid'`,
      "EventSource_feedUrlEnvelope_check",
    );
    await expectConstraint(
      `UPDATE "EventSource" SET "countryCode" = 'ae' WHERE "id" = 'event-source-valid'`,
      "EventSource_countryCode_check",
    );
    await expectConstraint(
      `UPDATE "EventSource" SET "socialWeight" = 11 WHERE "id" = 'event-source-valid'`,
      "EventSource_socialWeight_check",
    );
    await expectConstraint(
      `UPDATE "EventSource" SET "status" = 'unknown' WHERE "id" = 'event-source-valid'`,
      "EventSource_status_check",
    );
    await expectConstraint(
      `UPDATE "EventSource" SET "pollIntervalMinutes" = 14 WHERE "id" = 'event-source-valid'`,
      "EventSource_pollIntervalMinutes_check",
    );
    await expectConstraint(
      `UPDATE "DiscoveredEvent" SET "providerEventIdMac" = 'ABC' WHERE "id" = 'discovered-event-valid'`,
      "DiscoveredEvent_providerEventIdMac_check",
    );
    await expectConstraint(
      `UPDATE "DiscoveredEvent" SET "providerEventIdKeyVersion" = 0 WHERE "id" = 'discovered-event-valid'`,
      "DiscoveredEvent_providerEventIdEnvelope_check",
    );
    await expectConstraint(
      `UPDATE "DiscoveredEvent" SET "canonicalMac" = 'ABC' WHERE "id" = 'discovered-event-valid'`,
      "DiscoveredEvent_canonicalMac_check",
    );
    await expectConstraint(
      `UPDATE "DiscoveredEvent" SET "countryCode" = 'USA' WHERE "id" = 'discovered-event-valid'`,
      "DiscoveredEvent_countryCode_check",
    );
    await expectConstraint(
      `UPDATE "DiscoveredEvent" SET "status" = 'unknown' WHERE "id" = 'discovered-event-valid'`,
      "DiscoveredEvent_status_check",
    );
    await expectConstraint(
      `UPDATE "DiscoveredEvent" SET "endAt" = "startAt" WHERE "id" = 'discovered-event-valid'`,
      "DiscoveredEvent_timeRange_check",
    );
    await expectConstraint(
      `UPDATE "DiscoveredEvent" SET "longitude" = NULL WHERE "id" = 'discovered-event-valid'`,
      "DiscoveredEvent_coordinates_check",
    );
    await expectConstraint(
      `UPDATE "DiscoveredEvent" SET "latitude" = 90.000001 WHERE "id" = 'discovered-event-valid'`,
      "DiscoveredEvent_coordinates_check",
    );
    await assert.rejects(
      client.query(
        `INSERT INTO "DiscoveredEvent" (
           "id", "ownerId", "sourceId", "providerEventIdMac",
           "providerEventIdCiphertext", "providerEventIdIv", "providerEventIdTag",
           "providerEventIdKeyVersion", "canonicalMac", "title", "startAt", "endAt",
           "expiresAt", "updatedAt"
         ) VALUES (
           'event-cross-owner', 'event-other-owner', 'event-source-valid', repeat('d', 64),
           ${ciphertext}, ${iv}, ${tag}, 1, repeat('e', 64), 'Cross owner',
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 hour',
           CURRENT_TIMESTAMP + INTERVAL '14 days', CURRENT_TIMESTAMP
         )`,
      ),
      /foreign key constraint/,
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

  test("upgraded migration deployment adds brief, agent, calendar, location, and event schemas", async () => {
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
      assert.equal(await tableExists(client, "EventPreference"), false);
      assert.equal(await tableExists(client, "EventSource"), false);
      assert.equal(await tableExists(client, "DiscoveredEvent"), false);
      const eventMigration = readFileSync(eventDiscoveryMigrationPath, "utf8");
      const injectedFailure = eventMigration.replace(
        /\nCOMMIT;\s*$/,
        "\nSELECT 1 / 0;\nCOMMIT;\n",
      );
      assert.notEqual(
        injectedFailure,
        eventMigration,
        "event migration failure injection point was not found",
      );
      await assert.rejects(client.query(injectedFailure), /division by zero/);
      await client.query("ROLLBACK");
      assert.equal(await tableExists(client, "EventPreference"), false);
      assert.equal(await tableExists(client, "EventSource"), false);
      assert.equal(await tableExists(client, "DiscoveredEvent"), false);

      await client.query(eventMigration);
      await assertEventDiscoverySchema(client);
      await assertCalendarLocationSchema(client);
      await client.query(readFileSync(eventBriefSnapshotsMigrationPath, "utf8"));
      await assertEventBriefSnapshotSchema(client);

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
      await assertEventDiscoveryBehavior(client);
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
    await withClient(assertEventDiscoverySchema);
    await withClient(assertEventDiscoveryBehavior);
    await withClient(assertEventBriefSnapshotSchema);

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
    await withClient(assertEventDiscoverySchema);
    await withClient(assertEventBriefSnapshotSchema);
  });
}
