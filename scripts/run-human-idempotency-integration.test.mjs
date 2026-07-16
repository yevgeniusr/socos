import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  chmodSync,
  existsSync,
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
const runner = resolve(root, "scripts/run-human-idempotency-integration.mjs");
const temporaries = [];
const require = createRequire(import.meta.url);

afterEach(() => {
  for (const directory of temporaries.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fakePnpm() {
  const directory = mkdtempSync(join(tmpdir(), "socos-human-idempotency-runner-"));
  temporaries.push(directory);
  const bin = join(directory, "bin");
  mkdirSync(bin);
  const log = join(directory, "calls.jsonl");
  const executable = join(bin, "pnpm");
  writeFileSync(
    executable,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({
  argv: process.argv.slice(2),
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    HUMAN_IDEMPOTENCY_TEST_DATABASE_URL: process.env.HUMAN_IDEMPOTENCY_TEST_DATABASE_URL,
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    SENTRY_DSN: process.env.SENTRY_DSN,
    NODE_ENV: process.env.NODE_ENV,
  },
}) + "\\n");
`,
  );
  chmodSync(executable, 0o755);
  return { bin, log };
}

function run(url, fixture) {
  return spawnSync(process.execPath, [runner], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: `${fixture.bin}:${process.env.PATH}`,
      HOME: process.env.HOME,
      HUMAN_IDEMPOTENCY_TEST_DATABASE_URL: url,
      TEST_DATABASE_URL: "postgresql://leaky.invalid/migration_test",
      OPENAI_API_KEY: "must-not-propagate",
      SENTRY_DSN: "https://must-not-propagate.invalid",
    },
  });
}

test("default API Jest discovers in-tree integrations but not the moved PostgreSQL spec", () => {
  const config = require(resolve(root, "services/api/jest.config.cjs"));
  const dedicated = require(
    resolve(root, "services/api/jest.human-idempotency.integration.config.cjs"),
  );

  assert.equal(config.rootDir, "src");
  assert.equal(config.testPathIgnorePatterns, undefined);
  assert.equal(
    existsSync(
      resolve(
        root,
        "services/api/src/common/human-idempotency.integration.spec.ts",
      ),
    ),
    false,
  );
  assert.equal(
    existsSync(
      resolve(root, "services/api/test/human-idempotency.integration.spec.ts"),
    ),
    true,
  );
  assert.equal(dedicated.rootDir, ".");
  assert.equal(
    dedicated.testRegex,
    "test/human-idempotency\\.integration\\.spec\\.ts$",
  );

  const discovery = spawnSync(
    "pnpm",
    [
      "--filter",
      "@socos/api",
      "exec",
      "jest",
      "--config",
      "jest.config.cjs",
      "--listTests",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(discovery.status, 0, discovery.stderr);
  const testPaths = discovery.stdout.trim().split("\n");
  assert.equal(
    testPaths.some((path) =>
      path.endsWith("/src/cli/monica-import.integration.spec.ts"),
    ),
    true,
  );
  assert.equal(
    testPaths.some((path) =>
      path.endsWith("/test/human-idempotency.integration.spec.ts"),
    ),
    false,
  );
});

test("runner resets migrations and executes only the dedicated Jest config with sanitized env", () => {
  const fixture = fakePnpm();
  const url =
    "postgresql://runner:secret@example.invalid/socos_migration_test_ci_test";
  const result = run(url, fixture);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "human_idempotency_integration_status=passed\n");
  assert.equal(result.stderr, "");
  const calls = readFileSync(fixture.log, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(calls.map(({ argv }) => argv), [
    [
      "--filter",
      "@socos/api",
      "exec",
      "prisma",
      "migrate",
      "reset",
      "--force",
      "--skip-seed",
    ],
    [
      "--filter",
      "@socos/api",
      "exec",
      "jest",
      "--config",
      "jest.human-idempotency.integration.config.cjs",
      "--runInBand",
    ],
  ]);
  for (const call of calls) {
    assert.equal(call.env.DATABASE_URL, url);
    assert.equal(call.env.HUMAN_IDEMPOTENCY_TEST_DATABASE_URL, undefined);
    assert.equal(call.env.TEST_DATABASE_URL, undefined);
    assert.equal(call.env.OPENAI_API_KEY, undefined);
    assert.equal(call.env.SENTRY_DSN, undefined);
    assert.equal(call.env.NODE_ENV, "test");
  }
});

test("runner rejects near-miss database names before spawning children", () => {
  const fixture = fakePnpm();
  for (const url of [
    "postgresql://runner:secret@example.invalid/socos_test_ci_test",
    "postgresql://runner:secret@example.invalid/socos_human_idempotency_test_ci",
    "postgresql://runner:secret@example.invalid/socos_human_idempotency_test_ci_test/extra",
    "postgresql://runner:secret@example.invalid/socos_human_idempotency_test_ci_test?database=prod",
    "mysql://runner:secret@example.invalid/socos_human_idempotency_test_ci_test",
  ]) {
    const result = run(url, fixture);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "human_idempotency_integration_status=failed phase=validation\n",
    );
  }
  assert.equal(existsSync(fixture.log), false);
});

test("package and CI commands run the isolated integration after generic tests", () => {
  const rootPackage = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const workflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");

  assert.equal(
    rootPackage.scripts["test:human-idempotency-integration"],
    "node scripts/run-human-idempotency-integration.mjs",
  );
  assert.match(rootPackage.scripts.test, /run-human-idempotency-integration\.test\.mjs/);
  assert.match(
    workflow,
    /- name: Test[\s\S]*- name: Human idempotency PostgreSQL integration[\s\S]*pnpm test:human-idempotency-integration/,
  );
  const provisionedDatabase = workflow.match(/POSTGRES_DB:\s*([^\s]+)/)?.[1];
  const integrationUrl = workflow.match(
    /HUMAN_IDEMPOTENCY_TEST_DATABASE_URL:\s*([^\s]+)/,
  )?.[1];
  assert.equal(provisionedDatabase, "socos_migration_test_ci_test");
  assert.equal(
    new URL(integrationUrl).pathname.slice(1),
    provisionedDatabase,
    "the integration runner must use the database provisioned by the CI service",
  );
});
