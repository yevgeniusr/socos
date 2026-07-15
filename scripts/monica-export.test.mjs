import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const exporterPath = resolve(root, 'ops/monica-export.php');

test('Monica exporter streams a versioned, checksummed snapshot without row logging', () => {
  const source = readFileSync(exporterPath, 'utf8');

  assert.match(source, /socos-monica-contacts/);
  assert.match(source, /hash_init\('sha256'\)/);
  assert.match(source, /REPEATABLE READ READ ONLY/);
  assert.match(source, /WHERE c\.deleted_at IS NULL/);
  assert.match(source, /AND c\.listed = true/);
  assert.match(source, /LEFT JOIN companies/);
  assert.match(source, /contact_label/);
  assert.match(source, /contact_group/);
  assert.match(source, /JSON_THROW_ON_ERROR/);
  assert.match(source, /export_status=failed code=export_failed/);
  assert.doesNotMatch(
    source,
    /error->getMessage|\$error->getMessage|print_r|var_dump/,
  );
});
