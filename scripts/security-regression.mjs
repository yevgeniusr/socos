#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const forbiddenFingerprints = new Map([
  [
    "8d9120c899aaa54491fe320c2eb793ae8494451ea277271d825d7bec60f65612",
    "committed-coolify-token",
  ],
  [
    "beb7e92e35380ee5ba8c0058ad8b8d9b8203fc9963b6d231f694e1a332729b07",
    "committed-database-password",
  ],
  [
    "167bec39eb520e48a83143e3843c5e0a5aa55a4f18284dc48bea640ea30a85e0",
    "fallback-jwt-secret",
  ],
  [
    "7067907848e5b65c9c1eb9538168069599ba270bf10fe43fac4cc9c3d6154f02",
    "hardcoded-real-test-password",
  ],
  [
    "a7be3320a6dbb1da4230db68c74bd663e1d0426fe93ae71c34188404ccb5d956",
    "legacy-personal-password-hash",
  ],
  [
    "3c6fbfdb55991deacb9e44b0f792638454c5677df5287ffac7c4d4fb1183b552",
    "personal-account-email",
  ],
]);
const candidatePattern = /[A-Za-z0-9_@$./+-]{6,}/g;
const playwrightConfigPattern = /(?:^|\/)playwright\.config\.[cm]?[jt]s$/;
const productionE2EUrlPattern =
  /https:\/\/socos\.rachkovan\.com\.?(?=[/:`'"\s;]|$)/i;

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const violations = [];

for (const file of trackedFiles) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  const rules = new Set();
  for (const candidate of content.matchAll(candidatePattern)) {
    const fingerprint = createHash("sha256").update(candidate[0]).digest("hex");
    const rule = forbiddenFingerprints.get(fingerprint);
    if (rule) {
      rules.add(rule);
    }
  }

  if (
    playwrightConfigPattern.test(file) &&
    productionE2EUrlPattern.test(content)
  ) {
    rules.add("production-e2e-url");
  }

  for (const rule of rules) {
    violations.push({ file, rule });
  }
}

if (violations.length > 0) {
  console.error("Security regression scan failed:");
  for (const { file, rule } of violations) {
    console.error(`- ${file}: ${rule}`);
  }
  process.exit(1);
}

console.log(
  `Security regression scan passed (${trackedFiles.length} tracked files checked).`,
);
