import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module.js';
import { AiAgentController } from './modules/ai-agent/ai-agent.controller.js';
import { AiAgentModule } from './modules/ai-agent/ai-agent.module.js';
import { BriefsController } from './modules/briefs/briefs.controller.js';
import { BriefsModule } from './modules/briefs/briefs.module.js';
import { CalendarModule } from './modules/calendar/calendar.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { LocationDeviceController } from './modules/location/location.controller.js';
import { LocationModule } from './modules/location/location.module.js';
import { PersonalDataConfigService } from './modules/personal-data/personal-data-config.js';
import { PersonalDataModule } from './modules/personal-data/personal-data.module.js';
import { PrismaService } from './modules/prisma/prisma.service.js';

const APP_STARTUP_ENV = [
  'JWT_SECRET',
  'CALENDAR_SYNC_ENABLED',
  'LOCATION_INGEST_ENABLED',
  'EVENT_DISCOVERY_ENABLED',
  'EVENT_BRIEF_ENABLED',
  'EVENT_SOURCE_ALLOWED_HOSTS',
  'PERSONAL_DATA_KEYS',
  'PERSONAL_DATA_ACTIVE_KEY_VERSION',
  'PERSONAL_DATA_INDEX_KEY',
] as const;

async function withPersonalDataEnvironment<T>(
  values: Partial<Record<(typeof APP_STARTUP_ENV)[number], string>>,
  operation: () => Promise<T>
): Promise<T> {
  const previous = Object.fromEntries(
    APP_STARTUP_ENV.map((name) => [name, process.env[name]])
  );

  for (const name of APP_STARTUP_ENV) {
    const value = values[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  try {
    return await operation();
  } finally {
    for (const name of APP_STARTUP_ENV) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function compileAppForInitialization() {
  return Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
    .compile();
}

describe('AppModule composition', () => {
  it('compiles the complete dependency graph', async () => {
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'test-only-jwt-secret-at-least-32-characters';

    try {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      await moduleRef.close();
    } finally {
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
  });

  it('delegates AI agent controller ownership to AiAgentModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[];
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AppModule) as unknown[];

    expect(imports).toContain(AiAgentModule);
    expect(controllers).not.toContain(AiAgentController);
  });

  it('delegates brief controller ownership to BriefsModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[];
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AppModule) as unknown[];

    expect(imports).toContain(BriefsModule);
    expect(controllers).not.toContain(BriefsController);
  });

  it('boots the app with personal-data providers and no keys when all flags are disabled', async () => {
    await withPersonalDataEnvironment(
      {
        JWT_SECRET: 'test-only-jwt-secret-at-least-32-characters',
        CALENDAR_SYNC_ENABLED: 'false',
        LOCATION_INGEST_ENABLED: 'false',
        EVENT_DISCOVERY_ENABLED: 'false',
        EVENT_BRIEF_ENABLED: 'false',
      },
      async () => {
        const moduleRef = await compileAppForInitialization();
        try {
          expect(
            moduleRef.get(PersonalDataConfigService, { strict: false })
          ).toBeInstanceOf(PersonalDataConfigService);
          await expect(moduleRef.init()).resolves.toBe(moduleRef);
        } finally {
          await moduleRef.close();
        }
      }
    );
  });

  it('rejects app initialization when a feature is enabled without valid keys', async () => {
    await withPersonalDataEnvironment(
      {
        JWT_SECRET: 'test-only-jwt-secret-at-least-32-characters',
        CALENDAR_SYNC_ENABLED: 'false',
        LOCATION_INGEST_ENABLED: 'true',
        EVENT_DISCOVERY_ENABLED: 'false',
        EVENT_BRIEF_ENABLED: 'false',
      },
      async () => {
        const moduleRef = await compileAppForInitialization();
        let startupError: unknown;
        try {
          await moduleRef.init();
        } catch (error) {
          startupError = error;
        }

        expect(startupError).toBeInstanceOf(Error);
        expect((startupError as Error).message).toBe(
          'Invalid personal data encryption configuration'
        );
      }
    );
  });

  it('imports PersonalDataModule so startup validation is part of the app graph', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppModule
    ) as unknown[];

    expect(imports).toContain(PersonalDataModule);
  });

  it('delegates location endpoint ownership to LocationModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[];
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AppModule) as unknown[];

    expect(imports).toContain(LocationModule);
    expect(controllers).not.toContain(LocationDeviceController);
  });

  it('delegates calendar endpoint ownership to CalendarModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[];

    expect(imports).toContain(CalendarModule);
  });

  it('delegates event discovery ownership to EventsModule', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule) as unknown[];

    expect(imports).toContain(EventsModule);
  });
});
