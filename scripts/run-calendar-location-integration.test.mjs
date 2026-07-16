import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const script = resolve(root, "scripts/run-calendar-location-integration.mjs");
const temporaries = [];

afterEach(() => {
  for (const directory of temporaries.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createFakePnpm({ failOnCall } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "socos-calendar-runner-"));
  temporaries.push(directory);
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const log = join(directory, "calls.jsonl");
  const pnpm = join(bin, "pnpm");
  writeFileSync(
    pnpm,
    `#!/usr/bin/env node
const fs = require("node:fs");
const call = {
  argv: process.argv.slice(2),
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    CALENDAR_LOCATION_TEST_DATABASE_URL: process.env.CALENDAR_LOCATION_TEST_DATABASE_URL,
    GOOGLE_CALENDAR_CLIENT_ID: process.env.GOOGLE_CALENDAR_CLIENT_ID,
    GOOGLE_CALENDAR_CLIENT_SECRET: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    GOOGLE_CALENDAR_WEBHOOK_URL: process.env.GOOGLE_CALENDAR_WEBHOOK_URL,
    PERSONAL_DATA_ACTIVE_KEY_VERSION: process.env.PERSONAL_DATA_ACTIVE_KEY_VERSION,
    SENTRY_DSN: process.env.SENTRY_DSN,
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    NODE_ENV: process.env.NODE_ENV,
  },
};
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(call) + "\\n");
process.stdout.write("leaky-child-stdout synthetic-db-name\\n");
process.stderr.write("leaky-child-stderr synthetic-token\\n");
if (${Number(failOnCall ?? 0)} === callNumber()) process.exit(9);
function callNumber() {
  return fs.readFileSync(${JSON.stringify(log)}, "utf8").trim().split("\\n").length;
}
`,
  );
  chmodSync(pnpm, 0o755);
  return { directory, bin, log };
}

function runRunner({ url, bin, extraEnv = {} }) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      CALENDAR_LOCATION_TEST_DATABASE_URL: url,
      GOOGLE_CALENDAR_CLIENT_ID: "real-client-id-must-not-propagate",
      GOOGLE_CALENDAR_CLIENT_SECRET: "real-client-secret-must-not-propagate",
      GOOGLE_CALENDAR_WEBHOOK_URL: "https://real.example.invalid/hook",
      PERSONAL_DATA_ACTIVE_KEY_VERSION: "99",
      SENTRY_DSN: "https://real-sentry.example.invalid",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://real-otel.example.invalid",
      ...extraEnv,
    },
  });
}

test("rejects near-miss disposable database URLs before spawning children", () => {
  const fixture = createFakePnpm();
  const rejected = [
    "postgresql://user:pass@example.invalid/socos_calendar_location_prod_test",
    "postgresql://user:pass@example.invalid/socos_calendar_location_test_alpha",
    "postgresql://user:pass@example.invalid/socos_calendar_location_test_alpha_test/extra",
    "postgresql://user:pass@example.invalid/socos_calendar_location_test_alpha%2Fextra_test",
    "postgresql://user:pass@example.invalid/socos_calendar_location_test_alpha_test?host=evil",
    "postgresql://user:pass@example.invalid/socos_calendar_location_test_alpha_test?database=evil",
    "postgresql://user:pass@example.invalid/socos_calendar_location_test_alpha_test#frag",
    "mysql://user:pass@example.invalid/socos_calendar_location_test_alpha_test",
  ];

  for (const url of rejected) {
    const result = runRunner({ url, bin: fixture.bin });
    assert.notEqual(result.status, 0, url);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /^calendar_location_integration_status=failed phase=validation\n$/);
  }
  assert.throws(() => readFileSync(fixture.log, "utf8"), /ENOENT/);
});

test("runs migration and exact calendar-location Jest phases with sanitized synthetic env", () => {
  const fixture = createFakePnpm();
  const url =
    "postgresql://runner:secret@example.invalid/socos_calendar_location_test_alpha_test";

  const result = runRunner({ url, bin: fixture.bin });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "calendar_location_integration_status=passed\n");
  const calls = readFileSync(fixture.log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(calls.map((call) => call.argv), [
    ["--filter", "@socos/api", "exec", "prisma", "migrate", "deploy"],
    [
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
  ]);
  for (const call of calls) {
    assert.equal(call.env.DATABASE_URL, url);
    assert.equal(call.env.CALENDAR_LOCATION_TEST_DATABASE_URL, undefined);
    assert.match(call.env.GOOGLE_CALENDAR_CLIENT_ID, /^synthetic-calendar-client-/);
    assert.notEqual(call.env.GOOGLE_CALENDAR_CLIENT_ID, "real-client-id-must-not-propagate");
    assert.match(call.env.GOOGLE_CALENDAR_CLIENT_SECRET, /^synthetic-calendar-secret-/);
    assert.equal(call.env.GOOGLE_CALENDAR_WEBHOOK_URL, "https://calendar-location.test.invalid/google/webhook");
    assert.equal(call.env.PERSONAL_DATA_ACTIVE_KEY_VERSION, "2");
    assert.equal(call.env.SENTRY_DSN, undefined);
    assert.equal(call.env.OTEL_EXPORTER_OTLP_ENDPOINT, undefined);
    assert.equal(call.env.NODE_ENV, "test");
  }
});

test("reports fixed child phase failures without leaking child output or identifiers", () => {
  const fixture = createFakePnpm({ failOnCall: 2 });
  const url =
    "postgresql://runner:secret@example.invalid/socos_calendar_location_test_failure_test";

  const result = runRunner({ url, bin: fixture.bin });

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "calendar_location_integration_status=failed phase=jest\n");
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /leaky-child|synthetic-token|failure_test|secret/);
});
