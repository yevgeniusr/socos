#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const REQUIRED_ENV = "HUMAN_IDEMPOTENCY_TEST_DATABASE_URL";
const DATABASE_NAME_PATTERN =
  /^socos_(?:human_idempotency|migration)_test_[a-z0-9_]+_test$/;
const FORBIDDEN_QUERY_KEYS = new Set([
  "database",
  "db",
  "service",
  "host",
  "port",
]);
const PHASES = [
  {
    name: "migrate",
    args: [
      "--filter",
      "@socos/api",
      "exec",
      "prisma",
      "migrate",
      "reset",
      "--force",
      "--skip-seed",
    ],
  },
  {
    name: "jest",
    args: [
      "--filter",
      "@socos/api",
      "exec",
      "jest",
      "--config",
      "jest.human-idempotency.integration.config.cjs",
      "--runInBand",
    ],
  },
];

let databaseUrl;
try {
  databaseUrl = validateDisposableUrl(process.env[REQUIRED_ENV]);
} catch {
  fail("validation");
}

const env = sanitizedChildEnv(databaseUrl);
for (const phase of PHASES) {
  const result = spawnSync("pnpm", phase.args, {
    cwd: new URL("..", import.meta.url),
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) fail(phase.name);
}

process.stdout.write("human_idempotency_integration_status=passed\n");

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
  const encodedName = parsed.pathname.slice(1);
  if (
    !parsed.pathname.startsWith("/") ||
    encodedName.includes("/") ||
    /%2f|%5c/i.test(encodedName)
  ) {
    throw new Error("single_database_path_segment_required");
  }
  const databaseName = decodeURIComponent(encodedName);
  if (!DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error("invalid_test_database_name");
  }
  return value;
}

function sanitizedChildEnv(databaseUrl) {
  return Object.fromEntries(
    Object.entries({
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CI: process.env.CI,
      PNPM_HOME: process.env.PNPM_HOME,
      COREPACK_HOME: process.env.COREPACK_HOME,
      NODE_ENV: "test",
      SOCOS_TEST_MODE: "human-idempotency",
      DATABASE_URL: databaseUrl,
    }).filter(([, value]) => typeof value === "string")
  );
}

function fail(phase) {
  process.stderr.write(
    `human_idempotency_integration_status=failed phase=${phase}\n`
  );
  process.exit(1);
}
