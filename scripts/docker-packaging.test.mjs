import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');

test('web standalone build traces and preserves the monorepo layout', () => {
  const config = readFileSync(resolve(root, 'apps/web/next.config.mjs'), 'utf8');
  const dockerfile = readFileSync(resolve(root, 'docker/Dockerfile.web'), 'utf8');

  assert.match(
    config,
    /outputFileTracingRoot:\s*resolve\(__dirname, ['"]\.\.\/\.\.['"]\)/,
  );
  assert.match(
    dockerfile,
    /COPY package\.json pnpm-lock\.yaml pnpm-workspace\.yaml turbo\.json \.\//,
  );
  assert.match(
    dockerfile,
    /COPY --from=builder --chown=nextjs:nodejs \/app\/apps\/web\/\.next\/standalone \/app/,
  );
  assert.match(
    dockerfile,
    /COPY --from=builder --chown=nextjs:nodejs \/app\/apps\/web\/public \/app\/apps\/web\/public/,
  );
  assert.match(
    dockerfile,
    /COPY --from=builder --chown=nextjs:nodejs \/app\/apps\/web\/\.next\/static \/app\/apps\/web\/\.next\/static/,
  );
  assert.match(dockerfile, /CMD \["node", "apps\/web\/server\.js"\]/);
  assert.doesNotMatch(
    dockerfile,
    /COPY --from=builder --chown=nextjs:nodejs \/app\/node_modules \/app\/node_modules/,
  );
});
