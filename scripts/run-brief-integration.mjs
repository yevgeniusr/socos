import { spawnSync } from "node:child_process";

const raw = process.env.BRIEF_TEST_DATABASE_URL;
if (!raw) throw new Error("BRIEF_TEST_DATABASE_URL is required");

let parsed;
try {
  parsed = new URL(raw);
} catch {
  throw new Error("BRIEF_TEST_DATABASE_URL is invalid");
}

const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
if (!databaseName.endsWith("_test")) {
  throw new Error("Brief integration tests require a database ending in _test");
}

const env = { ...process.env, DATABASE_URL: raw };
for (const args of [
  ["--filter", "@socos/api", "exec", "prisma", "migrate", "deploy"],
  [
    "--filter",
    "@socos/api",
    "exec",
    "jest",
    "--config",
    "jest.integration.config.cjs",
    "--runInBand",
  ],
]) {
  const result = spawnSync("pnpm", args, {
    cwd: new URL("..", import.meta.url),
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
