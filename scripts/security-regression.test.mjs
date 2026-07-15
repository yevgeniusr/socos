import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scannerPath = resolve(repoRoot, "scripts/security-regression.mjs");
const temporaryRepos = [];

afterEach(() => {
  for (const directory of temporaryRepos.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createTrackedFixture(
  file,
  content,
  mutateScanner = (source) => source,
) {
  const directory = mkdtempSync(
    resolve(tmpdir(), "socos-security-regression-"),
  );
  temporaryRepos.push(directory);
  mkdirSync(resolve(directory, "scripts"));
  cpSync(scannerPath, resolve(directory, "scripts/security-regression.mjs"));

  const copiedScanner = resolve(directory, "scripts/security-regression.mjs");
  writeFileSync(
    copiedScanner,
    mutateScanner(readFileSync(copiedScanner, "utf8")),
  );
  writeFileSync(resolve(directory, file), content);
  execFileSync("git", ["init", "--quiet"], { cwd: directory });
  execFileSync("git", ["add", "."], { cwd: directory });
  return directory;
}

function runScanner(cwd) {
  return spawnSync(process.execPath, ["scripts/security-regression.mjs"], {
    cwd,
    encoding: "utf8",
  });
}

test("stores only SHA-256 fingerprints for forbidden secret values", () => {
  const source = readFileSync(scannerPath, "utf8");

  assert.match(source, /createHash\(['"]sha256['"]\)/);
  assert.doesNotMatch(source, /forbiddenValues|\.join\(/);
  assert.ok(source.match(/\b[0-9a-f]{64}\b/g)?.length >= 4);
});

test("detects a tracked secret candidate by its SHA-256 fingerprint without printing it", () => {
  const syntheticSecret =
    "synthetic_test_token_abcdefghijklmnopqrstuvwxyz_0123456789";
  const syntheticFingerprint = createHash("sha256")
    .update(syntheticSecret)
    .digest("hex");
  const directory = createTrackedFixture(
    "deployment.env",
    `COOLIFY_TOKEN=${syntheticSecret}\n`,
    (source) => source.replace(/\b[0-9a-f]{64}\b/, syntheticFingerprint),
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /deployment\.env: committed-/);
  assert.doesNotMatch(result.stderr, new RegExp(syntheticSecret));
});

test("detects the production E2E URL in an assignment fallback", () => {
  const directory = createTrackedFixture(
    "playwright.config.ts",
    "const baseURL = process.env.E2E_BASE_URL ?? 'https://socos.rachkovan.com';\n",
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /playwright\.config\.ts: production-e2e-url/);
  assert.doesNotMatch(result.stderr, /https:\/\//);
});
