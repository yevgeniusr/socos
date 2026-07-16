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
const briefsControllerPattern =
  /(?:^|\/)services\/api\/src\/modules\/briefs\/[^/]+\.controller\.ts$/;
const primaryBriefsControllerPattern = /(?:^|\/)briefs\.controller\.ts$/;
const briefRoutePattern =
  /@(Controller|Get|Post|Put|Patch|Delete)\s*\(([^)]*)\)/g;
const forbiddenBriefOperationPattern =
  /(?:^|\/)(?:send|messages?|recipients?|invites?|introduce|introductions?|merge|delete)(?:\/|$)/i;
const authenticatedBriefOwnerPattern = /\brequest\.user\.userId\b/;
const unsafeBriefOwnerPattern =
  /\b(?:dto|body|query|params?|headers?)\s*(?:\?\.|\.)\s*(?:ownerId|userId)\b/;
const briefIdempotencyHeaderPattern =
  /@Headers\s*\(\s*["']idempotency-key["']\s*\)/i;

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const violations = [];

function hasUnguardedBriefController(content) {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*export\s+class\s+\w+/.test(lines[index])) continue;

    const decorators = [];
    let cursor = index - 1;
    while (cursor >= 0) {
      if (lines[cursor].trim() === "") {
        cursor -= 1;
        continue;
      }

      const decoratorLines = [];
      let closingDepth = 0;
      let foundStart = false;
      while (cursor >= 0) {
        const line = lines[cursor].trim();
        decoratorLines.unshift(line);
        closingDepth += (line.match(/\)/g) ?? []).length;
        closingDepth -= (line.match(/\(/g) ?? []).length;
        cursor -= 1;
        if (line.startsWith("@") && closingDepth <= 0) {
          foundStart = true;
          break;
        }
      }
      if (!foundStart) break;
      decorators.unshift(
        decoratorLines.reduce(
          (text, line) => (text === "" ? line : `${text}\n${line}`),
          "",
        ),
      );
    }

    if (
      decorators.some((line) => /^@Controller\s*\(/.test(line)) &&
      !decorators.some((line) => /^@UseGuards\s*\(\s*AuthGuard\s*\)/.test(line))
    ) {
      return true;
    }
  }
  return false;
}

function staticDecoratorPath(argument, allowEmpty) {
  const trimmed = argument.trim();
  if (allowEmpty && trimmed === "") return "";
  const literal = /^(["'`])([^"'`]*)\1$/.exec(trimmed);
  if (!literal || (literal[1] === "`" && literal[2].includes("${"))) {
    return null;
  }
  return literal[2];
}

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

  if (briefsControllerPattern.test(file)) {
    if (hasUnguardedBriefController(content)) {
      rules.add("unguarded-brief-routes");
    }
    const routes = [...content.matchAll(briefRoutePattern)];
    for (const route of routes) {
      const isController = route[1] === "Controller";
      const path = staticDecoratorPath(route[2], !isController);
      if (
        route[1] === "Delete" ||
        path === null ||
        forbiddenBriefOperationPattern.test(path)
      ) {
        rules.add("forbidden-brief-operation");
      }
    }

    for (let index = 0; index < routes.length; index += 1) {
      const route = routes[index];
      if (route[1] === "Controller") continue;
      const start = route.index ?? 0;
      const end = routes[index + 1]?.index ?? content.length;
      const handler = content.slice(start, end);
      if (
        !authenticatedBriefOwnerPattern.test(handler) ||
        unsafeBriefOwnerPattern.test(handler)
      ) {
        rules.add("unsafe-brief-owner-source");
      }

      const path = staticDecoratorPath(route[2], true);
      const requiresIdempotency =
        ["Post", "Put", "Patch"].includes(route[1]) &&
        !(
          primaryBriefsControllerPattern.test(file) &&
          route[1] === "Post" &&
          path === "generate"
        );
      if (requiresIdempotency && !briefIdempotencyHeaderPattern.test(handler)) {
        rules.add("missing-brief-idempotency-keys");
      }
    }
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
