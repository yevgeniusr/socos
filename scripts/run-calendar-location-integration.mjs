#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const REQUIRED_ENV = "CALENDAR_LOCATION_TEST_DATABASE_URL";
const DATABASE_NAME_PATTERN = /^socos_calendar_location_test_[a-z0-9_]*_test$/;
const FORBIDDEN_QUERY_KEYS = new Set(["database", "db", "service", "host", "port"]);
const PHASES = [
  {
    name: "migrate",
    args: ["--filter", "@socos/api", "exec", "prisma", "migrate", "deploy"],
  },
  {
    name: "jest",
    args: [
      "--filter",
      "@socos/api",
      "exec",
      "jest",
      "--config",
      "jest.integration.config.cjs",
      "--runInBand",
      "--testRegex",
      "test/calendar-location\\.integration\\.spec\\.ts$",
    ],
  },
];

const rawUrl = process.env[REQUIRED_ENV];
let validatedUrl;
try {
  validatedUrl = validateDisposableUrl(rawUrl);
} catch {
  fail("validation");
}

const childEnv = sanitizedChildEnv(validatedUrl);
for (const phase of PHASES) {
  const result = spawnSync("pnpm", phase.args, {
    cwd: new URL("..", import.meta.url),
    env: childEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    fail(phase.name);
  }
}

process.stdout.write("calendar_location_integration_status=passed\n");

function validateDisposableUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("missing_test_database_url");
  }
  const parsed = new URL(value);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("invalid_protocol");
  }
  if (parsed.hash !== "") throw new Error("fragment_not_allowed");
  for (const key of parsed.searchParams.keys()) {
    if (FORBIDDEN_QUERY_KEYS.has(key.toLowerCase())) {
      throw new Error("query_override_not_allowed");
    }
  }

  const rawPath = parsed.pathname;
  if (!rawPath.startsWith("/") || rawPath.slice(1).includes("/")) {
    throw new Error("single_database_path_segment_required");
  }
  const encodedSegment = rawPath.slice(1);
  if (/%2f|%5c/i.test(encodedSegment)) {
    throw new Error("encoded_path_separator_not_allowed");
  }
  const databaseName = decodeURIComponent(encodedSegment);
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error("invalid_test_database_name");
  }
  return value;
}

function sanitizedChildEnv(databaseUrl) {
  const env = { ...process.env };
  delete env[REQUIRED_ENV];
  delete env.SENTRY_DSN;
  delete env.SENTRY_AUTH_TOKEN;
  delete env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete env.OTEL_EXPORTER_OTLP_HEADERS;
  delete env.POSTHOG_API_KEY;
  delete env.RESEND_API_KEY;
  delete env.TWILIO_ACCOUNT_SID;
  delete env.TWILIO_AUTH_TOKEN;
  delete env.OPENAI_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  delete env.GOOGLE_CALENDAR_CLIENT_ID;
  delete env.GOOGLE_CALENDAR_CLIENT_SECRET;
  delete env.GOOGLE_CALENDAR_REDIRECT_URI;
  delete env.GOOGLE_CALENDAR_WEBHOOK_URL;
  delete env.GOOGLE_CALENDAR_SETTINGS_RESULT_URL;
  delete env.GOOGLE_CALENDAR_CALLBACK_SECRET;
  delete env.OWNTRACKS_WEBHOOK_SECRET;
  delete env.EVENT_SOURCE_ALLOWED_HOSTS;

  const keyV1 = randomBytes(32).toString("base64");
  const keyV2 = randomBytes(32).toString("base64");
  return {
    ...env,
    NODE_ENV: "test",
    SOCOS_TEST_MODE: "calendar-location",
    DATABASE_URL: databaseUrl,
    CALENDAR_SYNC_ENABLED: "true",
    LOCATION_INGEST_ENABLED: "true",
    EVENT_DISCOVERY_ENABLED: "true",
    EVENT_BRIEF_ENABLED: "true",
    GOOGLE_CALENDAR_CLIENT_ID: `synthetic-calendar-client-${randomBytes(8).toString("hex")}`,
    GOOGLE_CALENDAR_CLIENT_SECRET: `synthetic-calendar-secret-${randomBytes(8).toString("hex")}`,
    GOOGLE_CALENDAR_REDIRECT_URI:
      "https://calendar-location.test.invalid/google/callback",
    GOOGLE_CALENDAR_WEBHOOK_URL:
      "https://calendar-location.test.invalid/google/webhook",
    GOOGLE_CALENDAR_SETTINGS_RESULT_URL:
      "https://calendar-location.test.invalid/google/settings",
    GOOGLE_CALENDAR_CALLBACK_SECRET: `synthetic-callback-${randomBytes(16).toString("hex")}`,
    OWNTRACKS_WEBHOOK_SECRET: `synthetic-owntracks-${randomBytes(16).toString("hex")}`,
    EVENT_SOURCE_ALLOWED_HOSTS: "events.test.invalid",
    PERSONAL_DATA_ACTIVE_KEY_VERSION: "2",
    PERSONAL_DATA_KEYS: JSON.stringify([
      { version: 1, key: keyV1 },
      { version: 2, key: keyV2 },
    ]),
    PERSONAL_DATA_INDEX_KEY: randomBytes(32).toString("base64"),
  };
}

function fail(phase) {
  process.stderr.write(
    `calendar_location_integration_status=failed phase=${phase}\n`,
  );
  process.exit(1);
}
