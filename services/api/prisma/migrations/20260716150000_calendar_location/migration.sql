BEGIN;

CREATE TABLE "GoogleOAuthAttempt" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "stateMac" TEXT NOT NULL,
  "pkceCiphertext" BYTEA NOT NULL,
  "pkceIv" BYTEA NOT NULL,
  "pkceTag" BYTEA NOT NULL,
  "pkceKeyVersion" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GoogleOAuthAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoogleOAuthAttempt_stateMac_check" CHECK ("stateMac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "GoogleOAuthAttempt_pkceEnvelope_check" CHECK ("pkceKeyVersion" > 0 AND octet_length("pkceIv") = 12 AND octet_length("pkceTag") = 16)
);

CREATE TABLE "GoogleCalendarConnection" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "refreshTokenCiphertext" BYTEA NOT NULL,
  "refreshTokenIv" BYTEA NOT NULL,
  "refreshTokenTag" BYTEA NOT NULL,
  "refreshTokenKeyVersion" INTEGER NOT NULL,
  "grantedScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'active',
  "calendarListSyncTokenCiphertext" BYTEA,
  "calendarListSyncTokenIv" BYTEA,
  "calendarListSyncTokenTag" BYTEA,
  "calendarListSyncTokenKeyVersion" INTEGER,
  "calendarListPendingAt" TIMESTAMP(3),
  "calendarListLeaseUntil" TIMESTAMP(3),
  "lastFullReconciledAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GoogleCalendarConnection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GoogleCalendarConnection_refreshTokenEnvelope_check" CHECK ("refreshTokenKeyVersion" > 0 AND octet_length("refreshTokenIv") = 12 AND octet_length("refreshTokenTag") = 16),
  CONSTRAINT "GoogleCalendarConnection_status_check" CHECK ("status" IN ('active', 'needs_reauth', 'disconnected')),
  CONSTRAINT "GoogleCalendarConnection_calendarListSyncTokenEnvelope_check" CHECK (
    num_nonnulls("calendarListSyncTokenCiphertext", "calendarListSyncTokenIv", "calendarListSyncTokenTag", "calendarListSyncTokenKeyVersion") IN (0, 4)
    AND ("calendarListSyncTokenKeyVersion" IS NULL OR ("calendarListSyncTokenKeyVersion" > 0 AND octet_length("calendarListSyncTokenIv") = 12 AND octet_length("calendarListSyncTokenTag") = 16))
  )
);

CREATE TABLE "CalendarSource" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "externalIdMac" TEXT NOT NULL,
  "externalIdCiphertext" BYTEA NOT NULL,
  "externalIdIv" BYTEA NOT NULL,
  "externalIdTag" BYTEA NOT NULL,
  "externalIdKeyVersion" INTEGER NOT NULL,
  "nameCiphertext" BYTEA NOT NULL,
  "nameIv" BYTEA NOT NULL,
  "nameTag" BYTEA NOT NULL,
  "nameKeyVersion" INTEGER NOT NULL,
  "timeZone" TEXT,
  "selected" BOOLEAN NOT NULL DEFAULT false,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "syncTokenCiphertext" BYTEA,
  "syncTokenIv" BYTEA,
  "syncTokenTag" BYTEA,
  "syncTokenKeyVersion" INTEGER,
  "fullSyncRequired" BOOLEAN NOT NULL DEFAULT true,
  "pendingSyncAt" TIMESTAMP(3),
  "syncLeaseUntil" TIMESTAMP(3),
  "lastFullReconciledAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CalendarSource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CalendarSource_externalIdMac_check" CHECK ("externalIdMac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "CalendarSource_externalIdEnvelope_check" CHECK ("externalIdKeyVersion" > 0 AND octet_length("externalIdIv") = 12 AND octet_length("externalIdTag") = 16),
  CONSTRAINT "CalendarSource_nameEnvelope_check" CHECK ("nameKeyVersion" > 0 AND octet_length("nameIv") = 12 AND octet_length("nameTag") = 16),
  CONSTRAINT "CalendarSource_syncTokenEnvelope_check" CHECK (
    num_nonnulls("syncTokenCiphertext", "syncTokenIv", "syncTokenTag", "syncTokenKeyVersion") IN (0, 4)
    AND ("syncTokenKeyVersion" IS NULL OR ("syncTokenKeyVersion" > 0 AND octet_length("syncTokenIv") = 12 AND octet_length("syncTokenTag") = 16))
  )
);

CREATE TABLE "CalendarWatch" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "resourceIdMac" TEXT NOT NULL,
  "resourceIdCiphertext" BYTEA NOT NULL,
  "resourceIdIv" BYTEA NOT NULL,
  "resourceIdTag" BYTEA NOT NULL,
  "resourceIdKeyVersion" INTEGER NOT NULL,
  "tokenMac" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastMessageNumber" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CalendarWatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CalendarWatch_targetType_check" CHECK ("targetType" IN ('calendar_list', 'events')),
  CONSTRAINT "CalendarWatch_status_check" CHECK ("status" IN ('active', 'stopping')),
  CONSTRAINT "CalendarWatch_resourceIdMac_check" CHECK ("resourceIdMac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "CalendarWatch_resourceIdEnvelope_check" CHECK ("resourceIdKeyVersion" > 0 AND octet_length("resourceIdIv") = 12 AND octet_length("resourceIdTag") = 16),
  CONSTRAINT "CalendarWatch_tokenMac_check" CHECK ("tokenMac" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "CalendarEvent" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "externalEventIdMac" TEXT NOT NULL,
  "externalEventIdCiphertext" BYTEA NOT NULL,
  "externalEventIdIv" BYTEA NOT NULL,
  "externalEventIdTag" BYTEA NOT NULL,
  "externalEventIdKeyVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'confirmed',
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "startDate" DATE,
  "endDate" DATE,
  "allDay" BOOLEAN NOT NULL DEFAULT false,
  "timeZone" TEXT,
  "transparency" TEXT NOT NULL DEFAULT 'opaque',
  "recurringEventIdMac" TEXT,
  "recurringEventIdCiphertext" BYTEA,
  "recurringEventIdIv" BYTEA,
  "recurringEventIdTag" BYTEA,
  "recurringEventIdKeyVersion" INTEGER,
  "originalStartAt" TIMESTAMP(3),
  "detailsCiphertext" BYTEA,
  "detailsIv" BYTEA,
  "detailsTag" BYTEA,
  "detailsKeyVersion" INTEGER,
  "sourceUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CalendarEvent_externalEventIdMac_check" CHECK ("externalEventIdMac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "CalendarEvent_externalEventIdEnvelope_check" CHECK ("externalEventIdKeyVersion" > 0 AND octet_length("externalEventIdIv") = 12 AND octet_length("externalEventIdTag") = 16),
  CONSTRAINT "CalendarEvent_status_check" CHECK ("status" IN ('confirmed', 'tentative', 'cancelled')),
  CONSTRAINT "CalendarEvent_transparency_check" CHECK ("transparency" IN ('opaque', 'transparent')),
  CONSTRAINT "CalendarEvent_recurringEventIdMac_check" CHECK ("recurringEventIdMac" IS NULL OR "recurringEventIdMac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "CalendarEvent_recurringEventIdEnvelope_check" CHECK (
    num_nonnulls("recurringEventIdCiphertext", "recurringEventIdIv", "recurringEventIdTag", "recurringEventIdKeyVersion") IN (0, 4)
    AND ("recurringEventIdKeyVersion" IS NULL OR ("recurringEventIdKeyVersion" > 0 AND octet_length("recurringEventIdIv") = 12 AND octet_length("recurringEventIdTag") = 16))
  ),
  CONSTRAINT "CalendarEvent_detailsEnvelope_check" CHECK (
    num_nonnulls("detailsCiphertext", "detailsIv", "detailsTag", "detailsKeyVersion") IN (0, 4)
    AND ("detailsKeyVersion" IS NULL OR ("detailsKeyVersion" > 0 AND octet_length("detailsIv") = 12 AND octet_length("detailsTag") = 16))
  ),
  CONSTRAINT "CalendarEvent_timing_check" CHECK (
    (("startAt" IS NULL AND "endAt" IS NULL AND "status" = 'cancelled') OR ("startAt" IS NOT NULL AND "endAt" IS NOT NULL AND "endAt" > "startAt"))
    AND ("status" = 'cancelled' OR "detailsCiphertext" IS NOT NULL)
  ),
  CONSTRAINT "CalendarEvent_allDay_check" CHECK (
    ("allDay" AND "startDate" IS NOT NULL AND "endDate" IS NOT NULL AND "endDate" > "startDate")
    OR (NOT "allDay" AND "startDate" IS NULL AND "endDate" IS NULL)
  )
);

CREATE TABLE "LocationDevice" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "nameMac" TEXT NOT NULL,
  "nameCiphertext" BYTEA NOT NULL,
  "nameIv" BYTEA NOT NULL,
  "nameTag" BYTEA NOT NULL,
  "nameKeyVersion" INTEGER NOT NULL,
  "username" TEXT NOT NULL,
  "credentialHash" TEXT NOT NULL,
  "externalDeviceIdMac" TEXT NOT NULL,
  "externalDeviceIdCiphertext" BYTEA NOT NULL,
  "externalDeviceIdIv" BYTEA NOT NULL,
  "externalDeviceIdTag" BYTEA NOT NULL,
  "externalDeviceIdKeyVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "rawRetentionDays" INTEGER NOT NULL DEFAULT 90,
  "derivedRetentionDays" INTEGER NOT NULL DEFAULT 730,
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LocationDevice_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LocationDevice_nameMac_check" CHECK ("nameMac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "LocationDevice_nameEnvelope_check" CHECK ("nameKeyVersion" > 0 AND octet_length("nameIv") = 12 AND octet_length("nameTag") = 16),
  CONSTRAINT "LocationDevice_username_check" CHECK ("username" ~ '^[A-Za-z0-9_-]{32}$'),
  CONSTRAINT "LocationDevice_credentialHash_check" CHECK ("credentialHash" ~ '^scrypt[$]32768[$]8[$]1[$][A-Za-z0-9_-]{22}[$][A-Za-z0-9_-]{43}$'),
  CONSTRAINT "LocationDevice_externalDeviceIdMac_check" CHECK ("externalDeviceIdMac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "LocationDevice_externalDeviceIdEnvelope_check" CHECK ("externalDeviceIdKeyVersion" > 0 AND octet_length("externalDeviceIdIv") = 12 AND octet_length("externalDeviceIdTag") = 16),
  CONSTRAINT "LocationDevice_status_check" CHECK ("status" IN ('active', 'revoked')),
  CONSTRAINT "LocationDevice_rawRetentionDays_check" CHECK ("rawRetentionDays" BETWEEN 30 AND 365),
  CONSTRAINT "LocationDevice_derivedRetentionDays_check" CHECK ("derivedRetentionDays" BETWEEN 90 AND 3650)
);

CREATE TABLE "LocationSample" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "coordinatesCiphertext" BYTEA NOT NULL,
  "coordinatesIv" BYTEA NOT NULL,
  "coordinatesTag" BYTEA NOT NULL,
  "coordinatesKeyVersion" INTEGER NOT NULL,
  "accuracyM" DOUBLE PRECISION,
  "batteryPercent" INTEGER,
  "trigger" TEXT,
  "payloadMac" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LocationSample_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LocationSample_coordinatesEnvelope_check" CHECK ("coordinatesKeyVersion" > 0 AND octet_length("coordinatesIv") = 12 AND octet_length("coordinatesTag") = 16),
  CONSTRAINT "LocationSample_accuracyM_check" CHECK ("accuracyM" IS NULL OR ("accuracyM" >= 0 AND "accuracyM" <= 1.7976931348623157e308)),
  CONSTRAINT "LocationSample_batteryPercent_check" CHECK ("batteryPercent" IS NULL OR "batteryPercent" BETWEEN 0 AND 100),
  CONSTRAINT "LocationSample_payloadMac_check" CHECK ("payloadMac" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "DerivedVisit" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "arrivedAt" TIMESTAMP(3) NOT NULL,
  "departedAt" TIMESTAMP(3),
  "centroidCiphertext" BYTEA NOT NULL,
  "centroidIv" BYTEA NOT NULL,
  "centroidTag" BYTEA NOT NULL,
  "centroidKeyVersion" INTEGER NOT NULL,
  "radiusM" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "sourceMac" TEXT NOT NULL,
  "derivationVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DerivedVisit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DerivedVisit_centroidEnvelope_check" CHECK ("centroidKeyVersion" > 0 AND octet_length("centroidIv") = 12 AND octet_length("centroidTag") = 16),
  CONSTRAINT "DerivedVisit_radiusM_check" CHECK ("radiusM" >= 0 AND "radiusM" <= 1.7976931348623157e308),
  CONSTRAINT "DerivedVisit_confidence_check" CHECK ("confidence" BETWEEN 0 AND 1),
  CONSTRAINT "DerivedVisit_sourceMac_check" CHECK ("sourceMac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "DerivedVisit_timeRange_check" CHECK ("departedAt" IS NULL OR "departedAt" > "arrivedAt")
);

CREATE TABLE "LocationAlias" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "aliasMac" TEXT NOT NULL,
  "aliasCiphertext" BYTEA NOT NULL,
  "aliasIv" BYTEA NOT NULL,
  "aliasTag" BYTEA NOT NULL,
  "aliasKeyVersion" INTEGER NOT NULL,
  "city" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL,
  "timeZone" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LocationAlias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LocationAlias_aliasMac_check" CHECK ("aliasMac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "LocationAlias_aliasEnvelope_check" CHECK ("aliasKeyVersion" > 0 AND octet_length("aliasIv") = 12 AND octet_length("aliasTag") = 16)
);

CREATE TABLE "CityStay" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3),
  "city" TEXT NOT NULL,
  "countryCode" TEXT NOT NULL,
  "timeZone" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CityStay_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CityStay_source_check" CHECK ("source" = 'calendar'),
  CONSTRAINT "CityStay_confidence_check" CHECK ("confidence" BETWEEN 0 AND 1),
  CONSTRAINT "CityStay_timeRange_check" CHECK ("endsAt" IS NULL OR "endsAt" > "startsAt")
);

CREATE TABLE "PersonalDataDeletionAudit" (
  "id" TEXT NOT NULL,
  "ownerMac" TEXT NOT NULL,
  "idempotencyKeyMac" TEXT NOT NULL,
  "requestMac" TEXT NOT NULL,
  "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "calendarRowCount" INTEGER NOT NULL DEFAULT 0,
  "locationRowCount" INTEGER NOT NULL DEFAULT 0,
  "eventRowCount" INTEGER NOT NULL DEFAULT 0,
  "deletedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PersonalDataDeletionAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PersonalDataDeletionAudit_ownerMac_check" CHECK ("ownerMac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "PersonalDataDeletionAudit_idempotencyKeyMac_check" CHECK ("idempotencyKeyMac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "PersonalDataDeletionAudit_requestMac_check" CHECK ("requestMac" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "PersonalDataDeletionAudit_rowCounts_check" CHECK ("calendarRowCount" >= 0 AND "locationRowCount" >= 0 AND "eventRowCount" >= 0)
);

CREATE UNIQUE INDEX "GoogleOAuthAttempt_stateMac_key" ON "GoogleOAuthAttempt"("stateMac");
CREATE UNIQUE INDEX "GoogleOAuthAttempt_id_ownerId_key" ON "GoogleOAuthAttempt"("id", "ownerId");
CREATE INDEX "GoogleOAuthAttempt_ownerId_expiresAt_consumedAt_idx" ON "GoogleOAuthAttempt"("ownerId", "expiresAt", "consumedAt");

CREATE UNIQUE INDEX "GoogleCalendarConnection_ownerId_key" ON "GoogleCalendarConnection"("ownerId");
CREATE UNIQUE INDEX "GoogleCalendarConnection_id_ownerId_key" ON "GoogleCalendarConnection"("id", "ownerId");
CREATE INDEX "GoogleCalendarConnection_status_calendarListPendingAt_calen_idx" ON "GoogleCalendarConnection"("status", "calendarListPendingAt", "calendarListLeaseUntil");

CREATE UNIQUE INDEX "CalendarSource_connectionId_externalIdMac_key" ON "CalendarSource"("connectionId", "externalIdMac");
CREATE UNIQUE INDEX "CalendarSource_id_ownerId_key" ON "CalendarSource"("id", "ownerId");
CREATE INDEX "CalendarSource_ownerId_selected_idx" ON "CalendarSource"("ownerId", "selected");
CREATE INDEX "CalendarSource_pendingSyncAt_syncLeaseUntil_idx" ON "CalendarSource"("pendingSyncAt", "syncLeaseUntil");

CREATE UNIQUE INDEX "CalendarWatch_channelId_key" ON "CalendarWatch"("channelId");
CREATE UNIQUE INDEX "CalendarWatch_id_ownerId_key" ON "CalendarWatch"("id", "ownerId");
CREATE INDEX "CalendarWatch_connectionId_targetType_targetKey_status_idx" ON "CalendarWatch"("connectionId", "targetType", "targetKey", "status");
CREATE INDEX "CalendarWatch_status_expiresAt_idx" ON "CalendarWatch"("status", "expiresAt");

CREATE UNIQUE INDEX "CalendarEvent_sourceId_externalEventIdMac_key" ON "CalendarEvent"("sourceId", "externalEventIdMac");
CREATE UNIQUE INDEX "CalendarEvent_id_ownerId_key" ON "CalendarEvent"("id", "ownerId");
CREATE INDEX "CalendarEvent_ownerId_startAt_endAt_status_idx" ON "CalendarEvent"("ownerId", "startAt", "endAt", "status");
CREATE INDEX "CalendarEvent_sourceId_status_idx" ON "CalendarEvent"("sourceId", "status");

CREATE UNIQUE INDEX "LocationDevice_username_key" ON "LocationDevice"("username");
CREATE UNIQUE INDEX "LocationDevice_ownerId_nameMac_key" ON "LocationDevice"("ownerId", "nameMac");
CREATE UNIQUE INDEX "LocationDevice_ownerId_externalDeviceIdMac_key" ON "LocationDevice"("ownerId", "externalDeviceIdMac");
CREATE UNIQUE INDEX "LocationDevice_id_ownerId_key" ON "LocationDevice"("id", "ownerId");
CREATE INDEX "LocationDevice_ownerId_status_idx" ON "LocationDevice"("ownerId", "status");

CREATE UNIQUE INDEX "LocationSample_deviceId_payloadMac_key" ON "LocationSample"("deviceId", "payloadMac");
CREATE UNIQUE INDEX "LocationSample_id_ownerId_key" ON "LocationSample"("id", "ownerId");
CREATE INDEX "LocationSample_ownerId_recordedAt_idx" ON "LocationSample"("ownerId", "recordedAt");
CREATE INDEX "LocationSample_deviceId_recordedAt_idx" ON "LocationSample"("deviceId", "recordedAt");

CREATE UNIQUE INDEX "DerivedVisit_deviceId_sourceMac_key" ON "DerivedVisit"("deviceId", "sourceMac");
CREATE UNIQUE INDEX "DerivedVisit_id_ownerId_key" ON "DerivedVisit"("id", "ownerId");
CREATE INDEX "DerivedVisit_ownerId_arrivedAt_departedAt_idx" ON "DerivedVisit"("ownerId", "arrivedAt", "departedAt");
CREATE INDEX "DerivedVisit_deviceId_arrivedAt_idx" ON "DerivedVisit"("deviceId", "arrivedAt");

CREATE UNIQUE INDEX "LocationAlias_ownerId_aliasMac_key" ON "LocationAlias"("ownerId", "aliasMac");
CREATE UNIQUE INDEX "LocationAlias_id_ownerId_key" ON "LocationAlias"("id", "ownerId");
CREATE INDEX "LocationAlias_ownerId_city_idx" ON "LocationAlias"("ownerId", "city");

CREATE UNIQUE INDEX "CityStay_ownerId_source_sourceId_key" ON "CityStay"("ownerId", "source", "sourceId");
CREATE UNIQUE INDEX "CityStay_id_ownerId_key" ON "CityStay"("id", "ownerId");
CREATE INDEX "CityStay_ownerId_startsAt_endsAt_idx" ON "CityStay"("ownerId", "startsAt", "endsAt");

CREATE UNIQUE INDEX "PersonalDataDeletionAudit_idempotencyKeyMac_key" ON "PersonalDataDeletionAudit"("idempotencyKeyMac");
CREATE INDEX "PersonalDataDeletionAudit_ownerMac_deletedAt_idx" ON "PersonalDataDeletionAudit"("ownerMac", "deletedAt");

ALTER TABLE "GoogleOAuthAttempt"
  ADD CONSTRAINT "GoogleOAuthAttempt_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GoogleCalendarConnection"
  ADD CONSTRAINT "GoogleCalendarConnection_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarSource"
  ADD CONSTRAINT "CalendarSource_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CalendarSource_connectionId_ownerId_fkey" FOREIGN KEY ("connectionId", "ownerId") REFERENCES "GoogleCalendarConnection"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarWatch"
  ADD CONSTRAINT "CalendarWatch_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CalendarWatch_connectionId_ownerId_fkey" FOREIGN KEY ("connectionId", "ownerId") REFERENCES "GoogleCalendarConnection"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CalendarEvent"
  ADD CONSTRAINT "CalendarEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "CalendarEvent_sourceId_ownerId_fkey" FOREIGN KEY ("sourceId", "ownerId") REFERENCES "CalendarSource"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LocationDevice"
  ADD CONSTRAINT "LocationDevice_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LocationSample"
  ADD CONSTRAINT "LocationSample_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "LocationSample_deviceId_ownerId_fkey" FOREIGN KEY ("deviceId", "ownerId") REFERENCES "LocationDevice"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DerivedVisit"
  ADD CONSTRAINT "DerivedVisit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "DerivedVisit_deviceId_ownerId_fkey" FOREIGN KEY ("deviceId", "ownerId") REFERENCES "LocationDevice"("id", "ownerId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LocationAlias"
  ADD CONSTRAINT "LocationAlias_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CityStay"
  ADD CONSTRAINT "CityStay_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "reject_personal_data_deletion_audit_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PersonalDataDeletionAudit is append-only';
END;
$$;

CREATE TRIGGER "PersonalDataDeletionAudit_append_only"
BEFORE UPDATE OR DELETE ON "PersonalDataDeletionAudit"
FOR EACH ROW EXECUTE FUNCTION "reject_personal_data_deletion_audit_change"();

COMMIT;
