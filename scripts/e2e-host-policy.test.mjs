import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { getStagingBaseUrl } from "../apps/web/e2e-host-policy.ts";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

for (const configPath of [
  "apps/web/playwright.config.ts",
  "tests/e2e/playwright.config.ts",
]) {
  test(`${configPath} delegates base URL validation to the shared staging policy`, () => {
    const source = readFileSync(resolve(repoRoot, configPath), "utf8");

    assert.match(source, /import \{ getStagingBaseUrl \}/);
    assert.match(source, /const baseURL = getStagingBaseUrl\(\)/);
  });
}

test("rejects the production hostname with a trailing dot", () => {
  assert.throws(
    () =>
      getStagingBaseUrl({
        E2E_ALLOWED_HOSTS: "socos.rachkovan.com",
        E2E_BASE_URL: "https://socos.rachkovan.com.",
      }),
    /must not target the production/i,
  );
});

test("rejects a host outside the staging allowlist", () => {
  assert.throws(
    () =>
      getStagingBaseUrl({
        E2E_ALLOWED_HOSTS: "staging.socos.example",
        E2E_BASE_URL: "https://attacker.example",
      }),
    /E2E_ALLOWED_HOSTS/,
  );
});

test("accepts an explicitly allowlisted staging host after normalization", () => {
  const baseURL = getStagingBaseUrl({
    E2E_ALLOWED_HOSTS: "STAGING.SOCOS.EXAMPLE.",
    E2E_BASE_URL: "https://staging.socos.example",
  });

  assert.equal(baseURL, "https://staging.socos.example");
});
