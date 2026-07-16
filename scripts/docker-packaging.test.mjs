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

test('api images package locked Prisma while keeping artifacts root-owned', () => {
  for (const path of ['services/api/Dockerfile', 'docker/Dockerfile.backend']) {
    const dockerfile = readFileSync(resolve(root, path), 'utf8');

    assert.doesNotMatch(dockerfile, /npm install -g prisma/);
    assert.match(
      dockerfile,
      /RUN \/prod\/api\/node_modules\/\.bin\/prisma --version/,
    );
    assert.match(dockerfile, /USER nestjs/);
    assert.doesNotMatch(dockerfile, /--chown=nestjs:nestjs/);
  }

  const startup = readFileSync(resolve(root, 'services/api/start.sh'), 'utf8');
  assert.match(startup, /\.\/node_modules\/\.bin\/prisma migrate deploy/);
  assert.doesNotMatch(startup, /command -v prisma/);
});

test('api images package the compiled Monica import CLI', () => {
  const tsconfig = readFileSync(
    resolve(root, 'services/api/tsconfig.json'),
    'utf8',
  );
  const importer = readFileSync(
    resolve(root, 'services/api/src/cli/monica-import.ts'),
    'utf8',
  );

  assert.match(tsconfig, /"include":\s*\[\s*"src"\s*\]/);
  assert.match(importer, /if \(require\.main === module\)/);
  for (const path of ['services/api/Dockerfile', 'docker/Dockerfile.backend']) {
    const dockerfile = readFileSync(resolve(root, path), 'utf8');
    assert.match(
      dockerfile,
      /COPY --from=builder \/app\/services\/api\/dist \.\/dist/,
    );
    assert.match(
      dockerfile,
      /RUN test -f \/app\/services\/api\/dist\/cli\/monica-import\.js/,
    );
  }

  const combinedDockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
  assert.match(
    combinedDockerfile,
    /RUN test -f \/app\/services\/api\/dist\/cli\/monica-import\.js/,
  );

  const workflow = readFileSync(
    resolve(root, '.github/workflows/ci.yml'),
    'utf8',
  );
  assert.match(workflow, /test -f \.\/dist\/cli\/monica-import\.js/);
});

test('runtime images package the personal data rekey CLI', () => {
  const apiPackage = JSON.parse(
    readFileSync(resolve(root, 'services/api/package.json'), 'utf8'),
  );
  assert.equal(
    apiPackage.scripts['personal-data:rekey'],
    'node dist/cli/rekey-personal-data.js',
  );

  const apiDockerfile = readFileSync(
    resolve(root, 'services/api/Dockerfile'),
    'utf8',
  );
  assert.match(
    apiDockerfile,
    /RUN test -f \/app\/services\/api\/dist\/cli\/rekey-personal-data\.js/,
  );
  assert.match(
    apiDockerfile,
    /COPY --from=builder \/app\/services\/api\/dist \.\/dist[\s\S]*RUN test -f \/app\/dist\/cli\/rekey-personal-data\.js/,
  );

  const combinedDockerfile = readFileSync(resolve(root, 'Dockerfile'), 'utf8');
  const artifactCheck =
    /RUN test -f \/app\/services\/api\/dist\/cli\/rekey-personal-data\.js/g;
  assert.equal(combinedDockerfile.match(artifactCheck)?.length, 2);
  assert.match(
    combinedDockerfile,
    /COPY --from=builder \/app\/services\/api\/dist \.\/services\/api\/dist/,
  );
});

test('all API runtime images assert Prisma schema, current personal-data migrations, and rekey CLI', () => {
  const apiImagePaths = [
    'services/api/Dockerfile',
    'docker/Dockerfile.backend',
    'Dockerfile',
  ];
  const requiredMigrationDirectories = [
    '20260716150000_calendar_location',
    '20260716160000_event_discovery',
    '20260716170000_event_brief_snapshots',
  ];

  for (const path of apiImagePaths) {
    const dockerfile = readFileSync(resolve(root, path), 'utf8');
    const prismaRoot = path === 'Dockerfile' ? '/app/services/api/prisma' : '/app/prisma';
    const rekeyPath =
      path === 'Dockerfile'
        ? '/app/services/api/dist/cli/rekey-personal-data.js'
        : '/app/dist/cli/rekey-personal-data.js';

    assert.match(dockerfile, new RegExp(`RUN test -f ${prismaRoot.replaceAll('/', '\\/')}\\/schema\\.prisma`));
    for (const migrationDirectory of requiredMigrationDirectories) {
      assert.match(
        dockerfile,
        new RegExp(
          `RUN test -f ${prismaRoot.replaceAll('/', '\\/')}\\/migrations\\/${migrationDirectory}\\/migration\\.sql`,
        ),
      );
    }
    assert.match(dockerfile, new RegExp(`RUN test -f ${rekeyPath.replaceAll('/', '\\/')}`));
  }
});

test('calendar location event secrets are runtime-only Compose inputs', () => {
  const compose = readFileSync(resolve(root, 'docker-compose.prod.yml'), 'utf8');
  for (const name of [
    'GOOGLE_CALENDAR_CLIENT_SECRET',
    'GOOGLE_CALENDAR_CALLBACK_SECRET',
    'OWNTRACKS_WEBHOOK_SECRET',
    'PERSONAL_DATA_KEYS',
    'PERSONAL_DATA_INDEX_KEY',
    'EVENT_SOURCE_ALLOWED_HOSTS',
  ]) {
    assert.match(compose, new RegExp(`- ${name}=\\$\\{${name}:\\?${name} is required\\}`));
  }

  for (const path of ['services/api/Dockerfile', 'docker/Dockerfile.backend', 'Dockerfile']) {
    const dockerfile = readFileSync(resolve(root, path), 'utf8');
    assert.doesNotMatch(
      dockerfile,
      /^\s*(?:ARG|ENV)\s+(?:GOOGLE_CALENDAR_CLIENT_SECRET|GOOGLE_CALENDAR_CALLBACK_SECRET|OWNTRACKS_WEBHOOK_SECRET|PERSONAL_DATA_KEYS|PERSONAL_DATA_INDEX_KEY|EVENT_SOURCE_ALLOWED_HOSTS)\b/m,
    );
  }
});
