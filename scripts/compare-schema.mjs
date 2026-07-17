#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(64);
}

const schema = resolve(process.env.PRISMA_SCHEMA ?? 'services/api/prisma/schema.prisma');
const result = spawnSync(
  'pnpm',
  [
    '--filter',
    '@socos/api',
    'exec',
    'prisma',
    'migrate',
    'diff',
    '--from-schema-datasource',
    schema,
    '--to-schema-datamodel',
    schema,
    '--script',
  ],
  { cwd: resolve(import.meta.dirname, '..'), encoding: 'utf8' },
);

if (result.error || result.status !== 0) {
  console.error('Schema comparison failed; inspect Prisma connectivity and schema configuration.');
  process.exit(1);
}

const sql = result.stdout ?? '';
const statements = sql
  .split(';')
  .map((part) => part.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean).length;

if (statements > 0) {
  console.log(`schema_status=drift statements=${statements}`);
  process.exit(2);
}

console.log('schema_status=match statements=0');
