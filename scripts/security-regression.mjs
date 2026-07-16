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
const personalContextControllerPattern =
  /(?:^|\/)services\/api\/src\/modules\/personal-data\/personal-context\.controller\.ts$/;
const personalContextSourcePattern =
  /(?:^|\/)services\/api\/src\/modules\/personal-data\/personal-context(?:\.controller|-deletion\.service)\.ts$/;
const personalContextRoutePattern =
  /@(Controller|Get|Post|Put|Patch|Delete|All)\s*\(([^)]*)\)/g;
const authenticatedPersonalContextOwnerPattern = /\brequest\.user\.userId\b/;
const personalContextIdempotencyHeaderPattern =
  /@Headers\s*\(\s*["']idempotency-key["']\s*\)/i;
const personalContextBodyPattern = /@Body\s*\(\s*\)\s*[A-Za-z_$][\w$]*/;
const unsafePersonalContextAuthorityPattern =
  /@(?:Query|Param)\s*\(|\b(?:dto|body|query|params?|headers?)\s*(?:\?\.|\.)\s*(?:ownerId|userId)\b/;
const unsafeRawSqlPattern = /\$(?:queryRawUnsafe|executeRawUnsafe)\b/;
const personalDataSourcePattern =
  /(?:^|\/)services\/api\/src\/modules\/(?:calendar|location|events|personal-data)\/.*\.ts$/;
const humanPersonalDataControllerPattern =
  /(?:^|\/)services\/api\/src\/modules\/(?:calendar|location|events)\/[^/]+\.controller\.ts$/;
const calendarControllerPattern =
  /(?:^|\/)services\/api\/src\/modules\/calendar\/[^/]+\.controller\.ts$/;
const locationControllerPattern =
  /(?:^|\/)services\/api\/src\/modules\/location\/[^/]+\.controller\.ts$/;
const personalDataConfigPattern =
  /(?:^|\/)services\/api\/src\/modules\/personal-data\/personal-data-config\.ts$/;
const exceptionFilterPattern =
  /(?:^|\/)services\/api\/src\/common\/filters\/http-exception\.filter\.ts$/;
const humanAgentControllerPattern =
  /(?:^|\/)services\/api\/src\/modules\/(?:agent-auth|agent-security)\/[^/]+\.controller\.ts$/;
const mcpControllerPattern =
  /(?:^|\/)services\/api\/src\/modules\/mcp\/[^/]+\.controller\.ts$/;
const agentSurfaceSourcePattern =
  /(?:^|\/)services\/api\/src\/modules\/(?:agent-auth|agent-security|agent-tools|mcp)\/.*\.ts$/;
const agentToolHandlerPattern =
  /(?:^|\/)services\/api\/src\/modules\/agent-tools\/tool-handlers\.ts$/;
const sharedAgentSchemaPattern =
  /(?:^|\/)packages\/agent-core\/src\/agent-interface\/schemas\.ts$/;
const agentToolInputSchemaPattern =
  /\b(?:export\s+)?const\s+\w*InputSchema\s*=([\s\S]*?)(?=\n(?:export\s+)?const\s+|\nexport\s+(?:function|type|class|interface)\b|\n@Injectable\b|$)/g;
const unsafeAgentInputFieldPattern =
  /\b(?:ownerId|userId|scopes|reward|xpReward|xpAwarded|xpEarned)\s*:/;
const unsafeAgentInputReadPattern =
  /\b(?:input|rawInput)\s*(?:\?\.|\.)\s*(?:ownerId|userId|scopes|reward|xpReward|xpAwarded|xpEarned)\b/;
const agentToolRegistrationPattern = /\btool\s*\(\s*["']([^"']+)["']/g;
const riskyAgentOperationPattern =
  /(?:^|[_/])(?:send|deliver|dispatch|messages?|introduce|introductions?|invite|invitations?|merge|delete|execute)(?:[_/:]|$)/i;
const allowedApprovalToolNames = new Set([
  "socos_propose_action",
  "socos_execute_approved_action",
]);
const agentRoutePattern =
  /@(Controller|Get|Post|Put|Patch|Delete|All)\s*\(([^)]*)\)/g;
const riskyAgentHandlerPattern =
  /^(?:send|deliver|dispatch|introduce|invite|merge|delete|execute)/i;
const agentRequestParameterPattern =
  /@(Body|Query|Param)\s*\([^)]*\)\s*([A-Za-z_$][\w$]*)/g;
const destructuredAgentAuthorityPattern =
  /@(Body|Query|Param)\s*\([^)]*\)\s*\{[^}]*(?:ownerId|userId)/s;
const allowedAgentMutationRoutes = new Set([
  "agent-clients|Post|",
  "agent-clients|Post|:clientId/rotate",
  "agent-clients|Delete|:clientId",
  "agent-proposals|Post|:proposalId/approve",
  "agent-proposals|Post|:proposalId/reject",
  "mcp|Post|",
]);
const loggingCallPattern =
  /\b(?:console|Logger|Sentry|(?:this\.)?logger)\.(?:log|info|warn|error|debug|verbose|fatal|captureMessage|captureException)\s*\(([\s\S]{0,1000}?)\)\s*;/g;
const sensitiveLogValuePattern =
  /\b(?:\w*(?:authorization|token|hash|body|coordinate|latitude|longitude|header|ciphertext|provider|payload|exception|stack)\w*|lat|lon|lng|location)\b/i;
const productionComposePattern = /(?:^|\/)docker-compose\.prod\.ya?ml$/;
const failClosedMcpHostPattern =
  /^\s*-\s*MCP_ALLOWED_HOSTS=(?:\$\{MCP_ALLOWED_HOSTS:\?[^}]+\}|[A-Za-z0-9.-]+(?:,[A-Za-z0-9.-]+)*)\s*$/m;
const task16SecretEnvNamePattern =
  /\b(?:GOOGLE_CALENDAR_CLIENT_SECRET|GOOGLE_CALENDAR_CALLBACK_SECRET|OWNTRACKS_WEBHOOK_SECRET|PERSONAL_DATA_KEYS|PERSONAL_DATA_INDEX_KEY|PERSONAL_DATA_ACTIVE_KEY_VERSION|EVENT_SOURCE_ALLOWED_HOSTS|CALENDAR_SYNC_ENABLED|LOCATION_INGEST_ENABLED|EVENT_DISCOVERY_ENABLED|EVENT_BRIEF_ENABLED)\b/;
const dockerBuildSecretSurfacePattern =
  /^\s*(?:ARG|ENV)\s+.*(?:GOOGLE_CALENDAR_CLIENT_SECRET|GOOGLE_CALENDAR_CALLBACK_SECRET|OWNTRACKS_WEBHOOK_SECRET|PERSONAL_DATA_KEYS|PERSONAL_DATA_INDEX_KEY|PERSONAL_DATA_ACTIVE_KEY_VERSION|EVENT_SOURCE_ALLOWED_HOSTS|CALENDAR_SYNC_ENABLED|LOCATION_INGEST_ENABLED|EVENT_DISCOVERY_ENABLED|EVENT_BRIEF_ENABLED)/m;
const publicFrontendSecretPattern =
  /\b(?:NEXT_PUBLIC_|VITE_PUBLIC_|PUBLIC_)[A-Z0-9_]*(?:GOOGLE_CALENDAR|OWNTRACKS|PERSONAL_DATA|EVENT_SOURCE|CALENDAR_SYNC|LOCATION_INGEST|EVENT_DISCOVERY|EVENT_BRIEF)[A-Z0-9_]*\b/;
const processEnvDynamicFeaturePattern = /\bprocess\.env\s*\[[^\]"'`]/;
const configDynamicFeaturePattern =
  /\bconfig(?:Service)?\.get\s*\(\s*(?!["'`][A-Z0-9_]+["'`]\s*\))/;

const trackedFiles = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

const violations = [];

function hasUnguardedBriefController(content) {
  return hasUnguardedController(content, "AuthGuard");
}

function hasUnguardedController(content, expectedGuard) {
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
      !decorators.some((line) =>
        new RegExp(`^@UseGuards\\s*\\(\\s*${expectedGuard}\\s*\\)`).test(line),
      )
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

function stripQuotedStrings(content) {
  return content.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "");
}

function collectControllerClasses(content) {
  const lines = content.split(/\r?\n/);
  const classes = [];
  for (let index = 0; index < lines.length; index += 1) {
    const classMatch = /^\s*export\s+class\s+([A-Za-z_$][\w$]*)/.exec(
      lines[index],
    );
    if (!classMatch) continue;

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
    if (!decorators.some((line) => /^@Controller\s*\(/.test(line))) continue;

    let end = index + 1;
    while (
      end < lines.length &&
      !/^\s*export\s+class\s+[A-Za-z_$][\w$]*/.test(lines[end])
    ) {
      end += 1;
    }
    classes.push({
      name: classMatch[1],
      decorators,
      body: lines
        .slice(index, end)
        .reduce((text, line) => (text === "" ? line : `${text}\n${line}`), ""),
    });
  }
  return classes;
}

function decoratorArgument(decorator, name) {
  const match = new RegExp(`^@${name}\\s*\\(([\\s\\S]*)\\)$`).exec(
    decorator.trim(),
  );
  return match?.[1];
}

function classControllerPath(controllerClass) {
  const decorator = controllerClass.decorators.find((line) =>
    /^@Controller\s*\(/.test(line),
  );
  const argument = decorator ? decoratorArgument(decorator, "Controller") : null;
  return argument === undefined || argument === null
    ? null
    : staticDecoratorPath(argument, false);
}

function classHasGuard(controllerClass, guardName) {
  return controllerClass.decorators.some((line) =>
    new RegExp(`^@UseGuards\\s*\\(\\s*${guardName}\\s*\\)`).test(line),
  );
}

function classRouteDecorators(controllerClass) {
  return [...controllerClass.body.matchAll(agentRoutePattern)].filter(
    (route) => route[1] !== "Controller",
  );
}

function routeHasGuard(controllerClass, route, guardName) {
  const routeStart = route.index ?? 0;
  const afterRoute = controllerClass.body.slice(routeStart, routeStart + 500);
  return new RegExp(`@UseGuards\\s*\\(\\s*${guardName}\\s*\\)`).test(
    afterRoute,
  );
}

function hasDynamicControllerPath(content) {
  return collectControllerClasses(content).some(
    (controllerClass) => classControllerPath(controllerClass) === null,
  );
}

function hasUnsafeHumanPersonalDataRoute(content) {
  for (const controllerClass of collectControllerClasses(content)) {
    const path = classControllerPath(controllerClass);
    if (path === null) continue;
    if (isProviderCallbackClass(controllerClass) || isOwnTracksClass(controllerClass)) {
      continue;
    }
    if (!classHasGuard(controllerClass, "AuthGuard")) {
      return true;
    }
    if (hasCallerControlledControllerOwner(controllerClass.body)) {
      return true;
    }
    for (const route of classRouteDecorators(controllerClass)) {
      if (staticDecoratorPath(route[2], true) === null) return true;
    }
  }
  return false;
}

function hasCallerControlledPersonalDataOwner(content) {
  return collectControllerClasses(content).some(
    (controllerClass) =>
      !isProviderCallbackClass(controllerClass) &&
      !isOwnTracksClass(controllerClass) &&
      hasCallerControlledControllerOwner(controllerClass.body),
  );
}

function isProviderCallbackClass(controllerClass) {
  return /GoogleCalendar(?:Webhook|Callback)Controller/.test(
    controllerClass.name,
  );
}

function isOwnTracksClass(controllerClass) {
  return controllerClass.name === "OwnTracksController";
}

function hasUnsafeProviderCallbackRoute(content) {
  for (const controllerClass of collectControllerClasses(content)) {
    if (!isProviderCallbackClass(controllerClass)) continue;
    if (classControllerPath(controllerClass) !== "integrations/google-calendar") {
      return true;
    }
    const routes = classRouteDecorators(controllerClass);
    if (routes.length !== 1) return true;
    const [route] = routes;
    const routePath = staticDecoratorPath(route[2], true);
    if (
      controllerClass.name === "GoogleCalendarWebhookController" &&
      !(
        route[1] === "Post" &&
        routePath === "webhook" &&
        /requireEnabled\s*\(\s*["']calendarSync["']\s*\)/.test(
          controllerClass.body,
        ) &&
        /\bparseWebhookHeaders\s*\(/.test(controllerClass.body) &&
        /\.handleWebhook\s*\(/.test(controllerClass.body)
      )
    ) {
      return true;
    }
    if (
      controllerClass.name === "GoogleCalendarCallbackController" &&
      !(
        route[1] === "Get" &&
        routePath === "callback" &&
        /requireEnabled\s*\(\s*["']calendarSync["']\s*\)/.test(
          controllerClass.body,
        ) &&
        /\bparseGoogleOAuthCallbackQuery\s*\(/.test(controllerClass.body) &&
        /\.handleCallback\s*\(/.test(controllerClass.body)
      )
    ) {
      return true;
    }
  }
  return false;
}

function hasUnsafeOwnTracksIngest(content) {
  if (!/\bexport\s+class\s+OwnTracksController\b/.test(content)) return false;
  return !/@Controller\s*\(\s*["']location["']\s*\)[\s\S]*?\bexport\s+class\s+OwnTracksController\b[\s\S]*?@Post\s*\(\s*["']owntracks["']\s*\)[\s\S]{0,200}?@UseGuards\s*\(\s*OwnTracksAuthGuard\s*\)/.test(
    content,
  );
}

function hasNonliteralFeatureParsing(file, content) {
  if (personalDataConfigPattern.test(file)) return false;
  return processEnvDynamicFeaturePattern.test(content) ||
    configDynamicFeaturePattern.test(content);
}

function hasUnsafeExceptionFilterTelemetry(content) {
  if (hasSensitiveAgentLogging(content)) return true;
  return /captureException\s*\([\s\S]*?(?:exception|headers|body|stack|message|request\.headers|request\.body)/.test(
    content,
  );
}

function hasCallerControlledAgentAuthority(content) {
  for (const match of content.matchAll(agentToolInputSchemaPattern)) {
    if (unsafeAgentInputFieldPattern.test(stripQuotedStrings(match[1]))) {
      return true;
    }
  }
  return unsafeAgentInputReadPattern.test(content);
}

function hasDirectRiskyAgentTool(content) {
  for (const match of content.matchAll(agentToolRegistrationPattern)) {
    if (
      riskyAgentOperationPattern.test(match[1]) &&
      !allowedApprovalToolNames.has(match[1])
    ) {
      return true;
    }
  }
  return false;
}

function hasDirectRiskyAgentRoute(content) {
  const routes = [...content.matchAll(agentRoutePattern)];
  const controller = routes.find((route) => route[1] === "Controller");
  const controllerPath = controller
    ? staticDecoratorPath(controller[2], false)
    : null;
  if (controllerPath === null) return true;

  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index];
    if (route[1] === "Controller") continue;
    const path = staticDecoratorPath(route[2], true);
    if (path === null || riskyAgentOperationPattern.test(path)) return true;
    if (
      ["Post", "Put", "Patch", "Delete"].includes(route[1]) &&
      !allowedAgentMutationRoutes.has(`${controllerPath}|${route[1]}|${path}`)
    ) {
      return true;
    }

    const start = route.index ?? 0;
    const end = routes[index + 1]?.index ?? content.length;
    const handler = content.slice(start, end);
    const declaration = /\n\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(
      handler,
    );
    if (declaration && riskyAgentHandlerPattern.test(declaration[1])) {
      return true;
    }
  }
  return false;
}

function hasCallerControlledControllerOwner(content) {
  if (destructuredAgentAuthorityPattern.test(content)) return true;
  for (const match of content.matchAll(agentRequestParameterPattern)) {
    const variable = match[2];
    if (/^(?:ownerId|userId)$/.test(variable)) return true;
    if (
      new RegExp(
        `\\b${variable}\\s*(?:\\?\\.|\\.)\\s*(?:ownerId|userId)\\b`,
      ).test(content)
    ) {
      return true;
    }
  }
  return false;
}

function hasSensitiveAgentLogging(content) {
  for (const match of content.matchAll(loggingCallPattern)) {
    if (sensitiveLogValuePattern.test(stripQuotedStrings(match[1]))) {
      return true;
    }
  }
  return false;
}

function hasAnyLogging(content) {
  return [...content.matchAll(loggingCallPattern)].length > 0;
}

function hasUnsafePersonalContextController(content) {
  if (hasUnguardedController(content, "AuthGuard")) return true;
  const routes = [...content.matchAll(personalContextRoutePattern)];
  const controller = routes.find((route) => route[1] === "Controller");
  const controllerPath = controller
    ? staticDecoratorPath(controller[2], false)
    : null;
  if (controllerPath !== "personal-context") return true;

  const handlers = routes.filter((route) => route[1] !== "Controller");
  if (handlers.length !== 1) return true;
  const [route] = handlers;
  const path = staticDecoratorPath(route[2], true);
  if (route[1] !== "Delete" || path === null || path !== "") return true;

  const start = route.index ?? 0;
  const handler = content.slice(start);
  return (
    !authenticatedPersonalContextOwnerPattern.test(handler) ||
    !personalContextIdempotencyHeaderPattern.test(handler) ||
    !personalContextBodyPattern.test(handler) ||
    unsafePersonalContextAuthorityPattern.test(handler)
  );
}

function composeServiceBlock(content, serviceName) {
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)([A-Za-z0-9_-]+):\s*$/.exec(lines[index]);
    if (!match || match[2] !== serviceName) continue;
    const indent = match[1].length;
    let end = index + 1;
    while (end < lines.length) {
      const next = /^(\s*)([A-Za-z0-9_-]+):\s*$/.exec(lines[end]);
      if (next && next[1].length <= indent) break;
      end += 1;
    }
    return lines
      .slice(index, end)
      .reduce((block, line) => (block === "" ? line : `${block}\n${line}`), "");
  }
  return null;
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

  if (personalContextControllerPattern.test(file)) {
    if (hasUnsafePersonalContextController(content)) {
      rules.add("unsafe-personal-context-deletion");
    }
  }

  if (humanPersonalDataControllerPattern.test(file)) {
    if (hasDynamicControllerPath(content)) {
      rules.add("dynamic-controller-path");
    }
    if (hasUnsafeHumanPersonalDataRoute(content)) {
      rules.add("unsafe-human-personal-data-route");
    }
    if (hasCallerControlledPersonalDataOwner(content)) {
      rules.add("caller-controlled-personal-data-owner");
    }
  }

  if (calendarControllerPattern.test(file) && hasUnsafeProviderCallbackRoute(content)) {
    rules.add("unsafe-provider-callback-route");
  }

  if (locationControllerPattern.test(file) && hasUnsafeOwnTracksIngest(content)) {
    rules.add("unsafe-owntracks-ingest");
  }

  if (
    personalContextSourcePattern.test(file) &&
    (hasAnyLogging(content) || unsafeRawSqlPattern.test(content))
  ) {
    rules.add("unsafe-personal-context-deletion");
  }

  if (personalDataSourcePattern.test(file)) {
    if (hasNonliteralFeatureParsing(file, content)) {
      rules.add("nonliteral-personal-data-feature-parsing");
    }
    if (unsafeRawSqlPattern.test(content)) {
      rules.add("unsafe-raw-sql");
    }
    if (hasSensitiveAgentLogging(content)) {
      rules.add("sensitive-personal-data-logging");
    }
  }

  if (exceptionFilterPattern.test(file) && hasUnsafeExceptionFilterTelemetry(content)) {
    rules.add("unsafe-exception-filter-telemetry");
  }

  if (humanAgentControllerPattern.test(file)) {
    if (hasUnguardedController(content, "AuthGuard")) {
      rules.add("unguarded-agent-admin-routes");
    }
    if (hasCallerControlledControllerOwner(content)) {
      rules.add("caller-controlled-agent-authority");
    }
    if (hasDirectRiskyAgentRoute(content)) {
      rules.add("direct-risky-agent-operation");
    }
  }

  if (mcpControllerPattern.test(file)) {
    if (hasUnguardedController(content, "AgentAuthGuard")) {
      rules.add("unguarded-mcp-routes");
    }
    if (hasDirectRiskyAgentRoute(content)) {
      rules.add("direct-risky-agent-operation");
    }
  }

  if (
    (agentToolHandlerPattern.test(file) ||
      sharedAgentSchemaPattern.test(file)) &&
    hasCallerControlledAgentAuthority(content)
  ) {
    rules.add("caller-controlled-agent-authority");
  }

  if (agentToolHandlerPattern.test(file) && hasDirectRiskyAgentTool(content)) {
    rules.add("direct-risky-agent-operation");
  }

  if (
    agentSurfaceSourcePattern.test(file) &&
    hasSensitiveAgentLogging(content)
  ) {
    rules.add("sensitive-agent-logging");
  }

  if (productionComposePattern.test(file)) {
    const apiService = composeServiceBlock(content, "api");
    if (
      apiService &&
      /NODE_ENV=production/.test(apiService) &&
      !failClosedMcpHostPattern.test(apiService)
    ) {
      rules.add("missing-production-mcp-host-policy");
    }
  }

  if (
    !/\.test\.[cm]?[jt]s$/.test(file) &&
    (dockerBuildSecretSurfacePattern.test(content) ||
      publicFrontendSecretPattern.test(content) ||
      (/(?:^|\/)(?:apps\/(?:web|platform)\/|docker\/|services\/api\/Dockerfile|Dockerfile)/.test(file) &&
        /(?:NEXT_PUBLIC_|VITE_PUBLIC_|PUBLIC_)/.test(content) &&
        task16SecretEnvNamePattern.test(content)))
  ) {
    rules.add("task16-secret-build-surface");
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
