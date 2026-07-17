import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const endpoint = "https://socos.rachkovan.com/api/mcp";
const validatorUrl = pathToFileURL(
  path.join(repositoryRoot, "scripts/validate-agent-plugin-packaging.mjs"),
).href;

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

async function readText(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

async function loadValidator() {
  return import(validatorUrl);
}

test("Codex marketplace installs the read-only Socos plugin from a repo-local path", async () => {
  const root = "integrations/codex/plugins/socos";
  const marketplace = await readJson(
    "integrations/codex/.agents/plugins/marketplace.json",
  );
  const manifest = await readJson(`${root}/.codex-plugin/plugin.json`);
  const mcp = await readJson(`${root}/.mcp.json`);

  assert.equal(marketplace.name, "socos-codex");
  assert.deepEqual(marketplace.plugins[0].source, {
    source: "local",
    path: "./plugins/socos",
  });
  assert.equal(manifest.name, "socos");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.deepEqual(manifest.interface.capabilities, ["Read"]);
  assert.deepEqual(mcp, {
    mcpServers: {
      socos: {
        type: "http",
        url: endpoint,
        bearer_token_env_var: "SOCOS_CODEX_TOKEN",
      },
    },
  });
});

test("Claude marketplace installs the read-only Socos plugin from a repo-local path", async () => {
  const root = "integrations/claude/socos";
  const marketplace = await readJson(
    "integrations/claude/.claude-plugin/marketplace.json",
  );
  const manifest = await readJson(`${root}/.claude-plugin/plugin.json`);
  const mcp = await readJson(`${root}/.mcp.json`);

  assert.equal(marketplace.name, "socos-claude");
  assert.equal(marketplace.plugins[0].source, "./socos");
  assert.equal(manifest.name, "socos");
  assert.equal(manifest.version, "0.1.0");
  assert.deepEqual(mcp, {
    socos: {
      type: "http",
      url: endpoint,
      headers: {
        Authorization: "Bearer ${SOCOS_CLAUDE_TOKEN}",
      },
    },
  });
});

test("both personal CRM skills permit automatic reads but forbid risky execution", async () => {
  const skillPaths = [
    "integrations/codex/plugins/socos/skills/socos-personal-crm/SKILL.md",
    "integrations/claude/socos/skills/socos-personal-crm/SKILL.md",
  ];

  for (const skillPath of skillPaths) {
    const skill = await readText(skillPath);
    assert.match(skill, /automatic(?:ally)? read/i, skillPath);
    assert.match(skill, /read-only credential/i, skillPath);
    assert.match(skill, /never execute[^\n]*(?:outbound|message)/i, skillPath);
    assert.match(skill, /never execute[^\n]*merge/i, skillPath);
    assert.match(skill, /never execute[^\n]*delet/i, skillPath);
    assert.match(skill, /approval is not execution/i, skillPath);
  }
});

test("strict validators reject malformed manifest metadata and unknown fields", async () => {
  const { validateClaudeManifest, validateCodexManifest } =
    await loadValidator();
  const codex = await readJson(
    "integrations/codex/plugins/socos/.codex-plugin/plugin.json",
  );
  const claude = await readJson(
    "integrations/claude/socos/.claude-plugin/plugin.json",
  );

  assert.throws(
    () => validateCodexManifest({ ...codex, version: "1.0" }),
    /strict semver/,
  );
  assert.throws(
    () => validateCodexManifest({ ...codex, unexpected: true }),
    /unknown field.*unexpected/,
  );
  assert.throws(
    () => validateCodexManifest({ ...codex, author: {} }),
    /author\.name/,
  );
  assert.throws(
    () => validateClaudeManifest({ ...claude, version: "v1.0.0" }),
    /strict semver/,
  );
  assert.throws(
    () => validateClaudeManifest({ ...claude, capabilities: ["Read"] }),
    /unknown field.*capabilities/,
  );
  assert.throws(
    () => validateClaudeManifest({ ...claude, description: "" }),
    /description/,
  );
});

test("skill validator rejects malformed and unsupported frontmatter", async () => {
  const { validateSkillFrontmatter } = await loadValidator();
  const valid = `---\nname: socos-personal-crm\ndescription: Use when reading Socos.\n---\n\n# Socos\n`;

  assert.doesNotThrow(() => validateSkillFrontmatter(valid, "valid skill"));
  assert.throws(
    () => validateSkillFrontmatter(valid.replace("\n---\n\n#", "\n#")),
    /closing delimiter/,
  );
  assert.throws(
    () => validateSkillFrontmatter(valid.replace("description:", "description")),
    /malformed frontmatter/,
  );
  assert.throws(
    () => validateSkillFrontmatter(valid.replace("---\n\n#", "version: 1.0.0\n---\n\n#")),
    /unknown field.*version/,
  );
  assert.throws(
    () => validateSkillFrontmatter(valid.replace(/description:.*\n/, "")),
    /description/,
  );
});

test("recursive package scan covers both marketplaces and rejects embedded credentials", async (t) => {
  const { collectPackagingFiles, validateRepositoryPackaging } =
    await loadValidator();
  const files = await collectPackagingFiles(repositoryRoot);

  assert.ok(
    files.includes("integrations/codex/.agents/plugins/marketplace.json"),
  );
  assert.ok(
    files.includes(
      "integrations/codex/plugins/socos/skills/socos-personal-crm/SKILL.md",
    ),
  );
  assert.ok(
    files.includes("integrations/claude/.claude-plugin/marketplace.json"),
  );
  assert.ok(files.includes("docs/integrations/codex-mcp.md"));
  assert.ok(files.includes("docs/integrations/claude-mcp.md"));
  await assert.doesNotReject(() => validateRepositoryPackaging(repositoryRoot));

  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "socos-plugin-test-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await cp(path.join(repositoryRoot, "integrations"), path.join(fixtureRoot, "integrations"), {
    recursive: true,
  });
  await cp(path.join(repositoryRoot, "docs"), path.join(fixtureRoot, "docs"), {
    recursive: true,
  });
  const leakPath = path.join(
    fixtureRoot,
    "integrations/claude/socos/skills/socos-personal-crm/nested-secret.json",
  );
  await writeFile(
    leakPath,
    '{"Authorization": "Bearer socos_live_real-token-1234567890"}\n',
  );
  await assert.rejects(
    () => validateRepositoryPackaging(fixtureRoot),
    /embedded bearer credential/,
  );
  await writeFile(leakPath, 'SOCOS_CODEX_TOKEN="real-token-1234567890"\n');
  await assert.rejects(
    () => validateRepositoryPackaging(fixtureRoot),
    /embedded token assignment/,
  );
});

test("clean-checkout install commands are documented without developer-home paths", async () => {
  const codex = await readText("docs/integrations/codex-mcp.md");
  const claude = await readText("docs/integrations/claude-mcp.md");
  const combined = `${codex}\n${claude}`;

  assert.match(codex, /codex plugin marketplace add integrations\/codex/);
  assert.match(codex, /codex plugin add socos@socos-codex/);
  assert.match(claude, /claude plugin marketplace add integrations\/claude/);
  assert.match(
    claude,
    /claude plugin install socos@socos-claude --scope user/,
  );
  assert.doesNotMatch(combined, /\/Users\/|~\//);
});

test("normal pnpm test runs plugin packaging verification", async () => {
  const packageJson = await readJson("package.json");
  assert.match(packageJson.scripts.test, /agent-plugin-packaging\.test\.mjs/);
});
