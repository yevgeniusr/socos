#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const productionHost = ['socos', 'rachkovan', 'com'].join('.');
const forbiddenValues = {
  'committed-coolify-token': ['pwDP3qcsqlEFbvEfedDWaRJfhiSLKfEC', 'ajoL94e178669eb8'].join(''),
  'committed-database-password': [
    '37BLEWztnVO7AqI8bQb9vUrCnnBif8uaThihxv4K9R7Nsa7Ai',
    'RiywB4K1Ob2nZIi',
  ].join(''),
  'fallback-jwt-secret': ['socos-dev-secret', '-2026'].join(''),
  'hardcoded-real-test-password': ['socos', '2026'].join(''),
};

const trackedFiles = execFileSync('git', ['ls-files', '-z'], {
  encoding: 'utf8',
}).split('\0').filter(Boolean);

const violations = [];

for (const file of trackedFiles) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  for (const [rule, value] of Object.entries(forbiddenValues)) {
    if (content.includes(value)) {
      violations.push({ file, rule });
    }
  }

  const productionBaseUrl = new RegExp(
    String.raw`baseURL\s*:\s*['\"\x60]https:\/\/${productionHost.replaceAll('.', String.raw`\.`)}\/?['\"\x60]`,
  );
  if (productionBaseUrl.test(content)) {
    violations.push({ file, rule: 'production-playwright-base-url' });
  }
}

if (violations.length > 0) {
  console.error('Security regression scan failed:');
  for (const { file, rule } of violations) {
    console.error(`- ${file}: ${rule}`);
  }
  process.exit(1);
}

console.log(`Security regression scan passed (${trackedFiles.length} tracked files checked).`);
