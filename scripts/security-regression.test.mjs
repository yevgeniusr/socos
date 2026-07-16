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
  mkdirSync(dirname(resolve(directory, file)), { recursive: true });
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

test("detects a tracked bcrypt credential by its fingerprint", () => {
  const syntheticHash =
    "$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ01234";
  const syntheticFingerprint = createHash("sha256")
    .update(syntheticHash)
    .digest("hex");
  const directory = createTrackedFixture(
    "seed.sql",
    `UPDATE users SET password_hash = '${syntheticHash}';\n`,
    (source) =>
      source.replace(
        "const candidatePattern =",
        `forbiddenFingerprints.set("${syntheticFingerprint}", "legacy-password-hash");\nconst candidatePattern =`,
      ),
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /seed\.sql: legacy-password-hash/);
  assert.doesNotMatch(
    result.stderr,
    new RegExp(syntheticHash.replaceAll("$", "\\$")),
  );
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

test("rejects an unguarded daily brief controller", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/briefs/briefs.controller.ts",
    `@Controller("briefs")\nexport class BriefsController {\n  @Get("today") today() {}\n}\n`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /briefs\.controller\.ts: unguarded-brief-routes/);
});

test("does not accept a method guard as protection for sibling brief routes", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/briefs/briefs.controller.ts",
    `@Controller("briefs")
export class BriefsController {
  @UseGuards(AuthGuard)
  @Get("today") today() {}
  @Post("generate") generate() {}
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /briefs\.controller\.ts: unguarded-brief-routes/);
});

test("rejects an unguarded controller with multiline decorators", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/briefs/briefs.controller.ts",
    `@Controller(
  "briefs",
)
export class BriefsController {
  @Get("today") today() {}
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /briefs\.controller\.ts: unguarded-brief-routes/);
});

test("scans every controller under the daily brief module", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/briefs/admin.controller.ts",
    `@Controller("briefs/admin")
export class BriefAdminController {
  @Get("status") status() {}
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /admin\.controller\.ts: unguarded-brief-routes/);
});

test("rejects direct-send or destructive daily brief routes", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/briefs/briefs.controller.ts",
    `@Controller("briefs")\n@UseGuards(AuthGuard)\nexport class BriefsController {\n  @Post("messages/send") sendMessage() {}\n  @Delete("contacts/:id") deleteContact() {}\n}\n`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /briefs\.controller\.ts: forbidden-brief-operation/,
  );
});

test("rejects brief mutations without authenticated ownership and idempotency keys", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/briefs/briefs.controller.ts",
    `@Controller("briefs")
@UseGuards(AuthGuard)
export class BriefsController {
  @Get("today") today(dto) { return this.service.get(dto.ownerId); }
  @Post("items/:itemId/feedback") item(dto) { return this.service.item(dto.ownerId, dto); }
  @Post("quests/:questId/complete") quest(dto) { return this.service.quest(dto.ownerId, dto); }
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /briefs\.controller\.ts: unsafe-brief-owner-source/,
  );
  assert.match(
    result.stderr,
    /briefs\.controller\.ts: missing-brief-idempotency-keys/,
  );
});

test("requires authenticated ownership inside every brief handler", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/briefs/briefs.controller.ts",
    `@Controller("briefs")
@UseGuards(AuthGuard)
export class BriefsController {
  @Get("today") today(request) { return this.service.get(request.user.userId); }
  @Post("generate") generate() { return this.service.generate("owner-from-constant"); }
  @Post("items/:itemId/feedback") item(request, @Headers("idempotency-key") idempotencyKey) {
    return this.service.item(request.user.userId, idempotencyKey);
  }
  @Post("quests/:questId/complete") quest(request, @Headers("idempotency-key") idempotencyKey) {
    return this.service.quest(request.user.userId, idempotencyKey);
  }
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /briefs\.controller\.ts: unsafe-brief-owner-source/,
  );
});

test("requires idempotency headers on each brief action handler", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/briefs/briefs.controller.ts",
    `@Controller("briefs")
@UseGuards(AuthGuard)
export class BriefsController {
  @Get("today") today(request, @Headers("idempotency-key") firstKey) {
    return this.service.get(request.user.userId, firstKey);
  }
  @Post("generate") generate(request, @Headers("idempotency-key") secondKey) {
    return this.service.generate(request.user.userId, secondKey);
  }
  @Post("items/:itemId/feedback") item(request) {
    return this.service.item(request.user.userId);
  }
  @Post("quests/:questId/complete") quest(request) {
    return this.service.quest(request.user.userId);
  }
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /briefs\.controller\.ts: missing-brief-idempotency-keys/,
  );
});

test("accepts the authenticated and idempotent daily brief controller", () => {
  const controller = readFileSync(
    resolve(repoRoot, "services/api/src/modules/briefs/briefs.controller.ts"),
    "utf8",
  );
  const directory = createTrackedFixture(
    "services/api/src/modules/briefs/briefs.controller.ts",
    controller,
  );

  const result = runScanner(directory);

  assert.equal(result.status, 0, result.stderr);
});

test("rejects dynamic daily brief paths that cannot be audited", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/briefs/briefs.controller.ts",
    `const SEND_PATH = "messages/send";
@Controller("briefs")
@UseGuards(AuthGuard)
export class BriefsController {
  @Post(SEND_PATH) sendMessage() {}
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /briefs\.controller\.ts: forbidden-brief-operation/,
  );
});

test("rejects interpolated template paths that cannot be audited", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/briefs/briefs.controller.ts",
    `const SEND_PATH = "messages/send";
@Controller("briefs")
@UseGuards(AuthGuard)
export class BriefsController {
  @Post(\`\${SEND_PATH}\`) sendMessage() {}
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /briefs\.controller\.ts: forbidden-brief-operation/,
  );
});

test("rejects an unguarded personal context deletion controller", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/personal-data/personal-context.controller.ts",
    `@Controller("personal-context")
export class PersonalContextController {
  @Delete() deletePersonalContext(request) {
    return this.service.deletePersonalContext(request.user.userId);
  }
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /personal-context\.controller\.ts: unsafe-personal-context-deletion/,
  );
});

test("rejects caller-controlled owner or confirmation fields on personal context deletion", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/personal-data/personal-context.controller.ts",
    `@Controller("personal-context")
@UseGuards(AuthGuard)
export class PersonalContextController {
  @Delete() deletePersonalContext(@Body() body, @Headers("idempotency-key") key) {
    return this.service.deletePersonalContext(body.ownerId, key, body);
  }
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /personal-context\.controller\.ts: unsafe-personal-context-deletion/,
  );
});

test("rejects personal context deletion routes with dynamic, nested, or non-DELETE handlers", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/personal-data/personal-context.controller.ts",
    `const PATH = "personal-context";
@Controller(PATH)
@UseGuards(AuthGuard)
export class PersonalContextController {
  @Post("preview") preview() {}
  @Delete(":ownerId") deleteForOwner() {}
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /personal-context\.controller\.ts: unsafe-personal-context-deletion/,
  );
});

test("rejects logging and unsafe raw SQL in personal context deletion", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/personal-data/personal-context-deletion.service.ts",
    `export class PersonalContextDeletionService {
  async deletePersonalContext(ownerId, idempotencyKey) {
    console.log(ownerId, idempotencyKey);
    return prisma.$queryRawUnsafe("SELECT " + ownerId);
  }
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /personal-context-deletion\.service\.ts: unsafe-personal-context-deletion/,
  );
});

test("accepts the authenticated static personal context deletion controller and quiet service", () => {
  const controller = readFileSync(
    resolve(
      repoRoot,
      "services/api/src/modules/personal-data/personal-context.controller.ts",
    ),
    "utf8",
  );
  const service = readFileSync(
    resolve(
      repoRoot,
      "services/api/src/modules/personal-data/personal-context-deletion.service.ts",
    ),
    "utf8",
  );
  const directory = createTrackedFixture(
    "services/api/src/modules/personal-data/personal-context.controller.ts",
    controller,
  );
  writeFileSync(
    resolve(
      directory,
      "services/api/src/modules/personal-data/personal-context-deletion.service.ts",
    ),
    service,
  );
  execFileSync("git", ["add", "."], { cwd: directory });

  const result = runScanner(directory);

  assert.equal(result.status, 0, result.stderr);
});

test("rejects dynamic or forbidden daily brief controller prefixes", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/briefs/briefs.controller.ts",
    `const CONTROLLER_PATH = "messages/send";
@Controller(CONTROLLER_PATH)
@UseGuards(AuthGuard)
export class BriefsController {
  @Post() sendMessage() {}
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /briefs\.controller\.ts: forbidden-brief-operation/,
  );
});

test("rejects an unguarded agent client administration controller", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/agent-auth/agent-auth.controller.ts",
    `@Controller("agent-clients")
export class AgentAuthController {
  @Get() list() {}
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /agent-auth\.controller\.ts: unguarded-agent-admin-routes/,
  );
});

test("rejects an unguarded human approval controller", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/agent-security/approval.controller.ts",
    `@Controller("agent-proposals")
export class ApprovalController {
  @Post(":proposalId/approve") approve() {}
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /approval\.controller\.ts: unguarded-agent-admin-routes/,
  );
});

test("rejects an MCP controller guarded only as a human route", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/mcp/mcp.controller.ts",
    `@Controller("mcp")
@UseGuards(AuthGuard)
export class McpController {
  @Post() post() {}
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mcp\.controller\.ts: unguarded-mcp-routes/);
});

for (const field of [
  "ownerId",
  "userId",
  "scopes",
  "reward",
  "xpReward",
  "xpAwarded",
]) {
  test(`rejects caller-controlled ${field} in an agent tool input schema`, () => {
    const directory = createTrackedFixture(
      "services/api/src/modules/agent-tools/tool-handlers.ts",
      `const unsafeInputSchema = z.strictObject({
  ${field}: z.string(),
});
`,
    );

    const result = runScanner(directory);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /tool-handlers\.ts: caller-controlled-agent-authority/,
    );
  });
}

test("rejects reading owner identity directly from parsed agent tool input", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/agent-tools/tool-handlers.ts",
    `export function unsafeHandler(input) {
  return service.find(input.ownerId);
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /tool-handlers\.ts: caller-controlled-agent-authority/,
  );
});

test("rejects owner identity sourced from an agent admin request body", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/agent-auth/agent-auth.controller.ts",
    `@Controller("agent-clients")
@UseGuards(AuthGuard)
export class AgentAuthController {
  @Post() create(@Body() input) {
    return this.service.create(input.ownerId, input);
  }
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /agent-auth\.controller\.ts: caller-controlled-agent-authority/,
  );
});

for (const toolName of [
  "socos_send_message",
  "socos_invite_contact",
  "socos_merge_contacts",
  "socos_delete_contact",
]) {
  test(`rejects direct risky agent tool ${toolName}`, () => {
    const directory = createTrackedFixture(
      "services/api/src/modules/agent-tools/tool-handlers.ts",
      `export function createExplicitAgentTools(handlers) {
  return [tool(
    "${toolName}",
    "Unsafe direct action.",
    "interactions:write",
    "automatic",
    true,
    inputSchema,
    handlers.run.bind(handlers),
  )];
}
`,
    );

    const result = runScanner(directory);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /tool-handlers\.ts: direct-risky-agent-operation/,
    );
  });
}

test("rejects a direct outbound action added to the approval controller", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/agent-security/approval.controller.ts",
    `@Controller("agent-proposals")
@UseGuards(AuthGuard)
export class ApprovalController {
  @Post(":proposalId/send") sendMessage() {}
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /approval\.controller\.ts: direct-risky-agent-operation/,
  );
});

test("rejects an unreviewed agent mutation hidden behind a neutral route name", () => {
  const directory = createTrackedFixture(
    "services/api/src/modules/agent-security/approval.controller.ts",
    `@Controller("agent-proposals")
@UseGuards(AuthGuard)
export class ApprovalController {
  @Post(":proposalId/run") runAction() {}
}
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /approval\.controller\.ts: direct-risky-agent-operation/,
  );
});

for (const sensitiveExpression of [
  "authorization",
  "tokenHash",
  "request.body",
  "coordinates",
]) {
  test(`rejects agent-surface logging of ${sensitiveExpression}`, () => {
    const directory = createTrackedFixture(
      "services/api/src/modules/mcp/mcp.controller.ts",
      `@Controller("mcp")
@UseGuards(AgentAuthGuard)
export class McpController {
  @Post() post(request) {
    console.log(${sensitiveExpression});
  }
}
`,
    );

    const result = runScanner(directory);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /mcp\.controller\.ts: sensitive-agent-logging/);
  });
}

test("rejects a production API service without a fail-closed MCP host allowlist", () => {
  const directory = createTrackedFixture(
    "docker-compose.prod.yml",
    `services:
  api:
    environment:
      - NODE_ENV=production
      - DATABASE_URL=synthetic
`,
  );

  const result = runScanner(directory);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /docker-compose\.prod\.yml: missing-production-mcp-host-policy/,
  );
});
