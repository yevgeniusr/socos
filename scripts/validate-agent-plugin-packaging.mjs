import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const semverPattern = /^\d+\.\d+\.\d+$/;
const endpoint = "https://socos.rachkovan.com/api/mcp";
const codexManifestFields = new Set([
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "skills",
  "mcpServers",
  "interface",
]);
const claudeManifestFields = new Set([
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
]);
const skillFields = new Set(["name", "description"]);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function rejectUnknownFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`${label} unknown field: ${key}`);
    }
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertStrictSemver(version, label = "version") {
  if (typeof version !== "string" || !semverPattern.test(version)) {
    throw new Error(`${label} must use strict semver`);
  }
}

export function validateCodexManifest(manifest) {
  assertObject(manifest, "Codex manifest");
  rejectUnknownFields(manifest, codexManifestFields, "Codex manifest");
  assertNonEmptyString(manifest.name, "name");
  assertStrictSemver(manifest.version);
  assertNonEmptyString(manifest.description, "description");
  assertObject(manifest.author, "author");
  assertNonEmptyString(manifest.author.name, "author.name");
  if (manifest.skills !== "./skills/") {
    throw new Error("skills must point to ./skills/");
  }
  if (manifest.mcpServers !== "./.mcp.json") {
    throw new Error("mcpServers must point to ./.mcp.json");
  }
  assertObject(manifest.interface, "interface");
  if (!Array.isArray(manifest.interface.capabilities)) {
    throw new Error("interface.capabilities must be an array");
  }
  if (manifest.interface.capabilities.join(",") !== "Read") {
    throw new Error("interface.capabilities must contain only Read");
  }
}

export function validateClaudeManifest(manifest) {
  assertObject(manifest, "Claude manifest");
  rejectUnknownFields(manifest, claudeManifestFields, "Claude manifest");
  assertNonEmptyString(manifest.name, "name");
  assertStrictSemver(manifest.version);
  assertNonEmptyString(manifest.description, "description");
  assertObject(manifest.author, "author");
  assertNonEmptyString(manifest.author.name, "author.name");
}

export function validateSkillFrontmatter(content, label) {
  if (!content.startsWith("---\n")) {
    throw new Error(`${label} missing opening delimiter`);
  }
  const closingIndex = content.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    throw new Error(`${label} missing closing delimiter`);
  }
  const frontmatter = content.slice(4, closingIndex).trim();
  const fields = new Map();
  for (const line of frontmatter.split("\n")) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.+)$/);
    if (!match) {
      throw new Error(`${label} has malformed frontmatter`);
    }
    const [, key, value] = match;
    if (!skillFields.has(key)) {
      throw new Error(`${label} unknown field: ${key}`);
    }
    fields.set(key, value.trim());
  }
  assertNonEmptyString(fields.get("name"), `${label} name`);
  assertNonEmptyString(fields.get("description"), `${label} description`);
}

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function readText(root, relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function walk(root, relativeDir = "") {
  const absoluteDir = path.join(root, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(root, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath.split(path.sep).join("/"));
    }
  }
  return files;
}

export async function collectPackagingFiles(repositoryRoot) {
  const roots = [
    "integrations/codex",
    "integrations/claude",
    "docs/integrations",
  ];
  const files = [];
  for (const root of roots) {
    try {
      if ((await stat(path.join(repositoryRoot, root))).isDirectory()) {
        files.push(...(await walk(repositoryRoot, root)));
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return files.sort();
}

function validateNoEmbeddedCredentials(content, relativePath) {
  const bearerCredential =
    /Bearer\s+(?!\$\{SOCOS_[A-Z_]+_TOKEN\})(?!<token>)(?!\.\.\.)[A-Za-z0-9._~+/-]{16,}/i;
  const tokenAssignment =
    /\bSOCOS_(?:CODEX|CLAUDE)_TOKEN\s*=\s*["']?(?!\$\{SOCOS_[A-Z_]+_TOKEN\})(?!<token>)[A-Za-z0-9._~+/-]{12,}/i;
  if (bearerCredential.test(content)) {
    throw new Error(`${relativePath} contains embedded bearer credential`);
  }
  if (tokenAssignment.test(content)) {
    throw new Error(`${relativePath} contains embedded token assignment`);
  }
}

export async function validateRepositoryPackaging(repositoryRoot) {
  const codexMarketplace = await readJson(
    repositoryRoot,
    "integrations/codex/.agents/plugins/marketplace.json",
  );
  if (codexMarketplace.name !== "socos-codex") {
    throw new Error("Codex marketplace name must be socos-codex");
  }
  if (
    JSON.stringify(codexMarketplace.plugins?.[0]?.source) !==
    JSON.stringify({ source: "local", path: "./plugins/socos" })
  ) {
    throw new Error("Codex marketplace must point to ./plugins/socos");
  }

  const claudeMarketplace = await readJson(
    repositoryRoot,
    "integrations/claude/.claude-plugin/marketplace.json",
  );
  if (claudeMarketplace.name !== "socos-claude") {
    throw new Error("Claude marketplace name must be socos-claude");
  }
  if (claudeMarketplace.plugins?.[0]?.source !== "./socos") {
    throw new Error("Claude marketplace must point to ./socos");
  }

  validateCodexManifest(
    await readJson(
      repositoryRoot,
      "integrations/codex/plugins/socos/.codex-plugin/plugin.json",
    ),
  );
  validateClaudeManifest(
    await readJson(
      repositoryRoot,
      "integrations/claude/socos/.claude-plugin/plugin.json",
    ),
  );

  const codexMcp = await readJson(
    repositoryRoot,
    "integrations/codex/plugins/socos/.mcp.json",
  );
  if (codexMcp.mcpServers?.socos?.url !== endpoint) {
    throw new Error("Codex MCP endpoint mismatch");
  }
  if (codexMcp.mcpServers?.socos?.bearer_token_env_var !== "SOCOS_CODEX_TOKEN") {
    throw new Error("Codex MCP must use SOCOS_CODEX_TOKEN");
  }

  const claudeMcp = await readJson(
    repositoryRoot,
    "integrations/claude/socos/.mcp.json",
  );
  if (claudeMcp.socos?.url !== endpoint) {
    throw new Error("Claude MCP endpoint mismatch");
  }
  if (claudeMcp.socos?.headers?.Authorization !== "Bearer ${SOCOS_CLAUDE_TOKEN}") {
    throw new Error("Claude MCP must use SOCOS_CLAUDE_TOKEN placeholder");
  }

  const skillPaths = [
    "integrations/codex/plugins/socos/skills/socos-personal-crm/SKILL.md",
    "integrations/claude/socos/skills/socos-personal-crm/SKILL.md",
  ];
  for (const skillPath of skillPaths) {
    validateSkillFrontmatter(await readText(repositoryRoot, skillPath), skillPath);
  }

  const files = await collectPackagingFiles(repositoryRoot);
  for (const relativePath of files) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    const content = await readFile(absolutePath, "utf8");
    validateNoEmbeddedCredentials(content, relativePath);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const repositoryRoot = path.resolve(process.argv[2] ?? process.cwd());
  validateRepositoryPackaging(repositoryRoot).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
