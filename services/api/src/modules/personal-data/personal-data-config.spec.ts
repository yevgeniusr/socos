import { ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { PersonalDataCipherService } from "./personal-data-cipher.service.js";
import {
  PersonalDataConfigService,
  type PersonalDataFeature,
} from "./personal-data-config.js";
import { PersonalDataIndexService } from "./personal-data-index.service.js";

const KEYRING = JSON.stringify([
  { version: 1, key: Buffer.alloc(32, 0x61).toString("base64") },
]);
const INDEX_KEY = Buffer.alloc(32, 0x62).toString("base64");
const FEATURE_ENV: Record<PersonalDataFeature, string> = {
  calendarSync: "CALENDAR_SYNC_ENABLED",
  locationIngest: "LOCATION_INGEST_ENABLED",
  eventDiscovery: "EVENT_DISCOVERY_ENABLED",
  eventBrief: "EVENT_BRIEF_ENABLED",
};

function createConfig(values: Record<string, unknown> = {}): ConfigService {
  return {
    get: jest.fn((name: string) => values[name]),
  } as unknown as ConfigService;
}

function createService(values: Record<string, unknown> = {}) {
  const config = createConfig(values);
  const cipher = new PersonalDataCipherService(config);
  const index = new PersonalDataIndexService(config);
  return {
    service: new PersonalDataConfigService(config, cipher, index),
    cipher,
    index,
  };
}

function validKeys(): Record<string, string> {
  return {
    PERSONAL_DATA_KEYS: KEYRING,
    PERSONAL_DATA_ACTIVE_KEY_VERSION: "1",
    PERSONAL_DATA_INDEX_KEY: INDEX_KEY,
  };
}

function validGoogle(): Record<string, string> {
  return {
    GOOGLE_CALENDAR_CLIENT_ID: "synthetic-client-id",
    GOOGLE_CALENDAR_CLIENT_SECRET: "synthetic-client-secret",
    GOOGLE_CALENDAR_REDIRECT_URI:
      "https://example.test/api/integrations/google-calendar/callback",
    GOOGLE_CALENDAR_WEBHOOK_URL: "https://example.test/webhook",
    GOOGLE_CALENDAR_SETTINGS_RESULT_URL: "https://example.test/settings",
  };
}

describe("PersonalDataConfigService", () => {
  it.each(Object.entries(FEATURE_ENV))(
    "enables %s only for the literal string true",
    (feature) => {
      for (const value of [
        undefined,
        "",
        "false",
        "TRUE",
        "1",
        " true ",
        true,
      ]) {
        expect(
          createService({
            [FEATURE_ENV[feature as PersonalDataFeature]]: value,
          }).service.isEnabled(feature as PersonalDataFeature)
        ).toBe(false);
      }
      expect(
        createService({
          [FEATURE_ENV[feature as PersonalDataFeature]]: "true",
        }).service.isEnabled(feature as PersonalDataFeature)
      ).toBe(true);
    }
  );

  it("allows all personal-data providers to initialize without keys when every flag is disabled", () => {
    const { service } = createService();

    expect(() => service.onModuleInit()).not.toThrow();
  });

  it.each(Object.keys(FEATURE_ENV) as PersonalDataFeature[])(
    "fails startup closed when %s is enabled without encryption keys",
    (feature) => {
      const { service } = createService({ [FEATURE_ENV[feature]]: "true" });

      expect(() => service.onModuleInit()).toThrow(
        "Invalid personal data encryption configuration"
      );
    }
  );

  it("validates both encryption and index configuration when a feature is enabled", () => {
    const { service, cipher, index } = createService({
      ...validKeys(),
      LOCATION_INGEST_ENABLED: "true",
    });
    const cipherValidation = jest.spyOn(cipher, "validateConfiguration");
    const indexValidation = jest.spyOn(index, "validateConfiguration");

    service.onModuleInit();

    expect(cipherValidation).toHaveBeenCalledTimes(1);
    expect(indexValidation).toHaveBeenCalledTimes(1);
  });

  it("fails startup closed when Calendar is enabled without provider configuration", () => {
    const { service } = createService({
      ...validKeys(),
      CALENDAR_SYNC_ENABLED: "true",
      GOOGLE_CALENDAR_CLIENT_ID: "synthetic-sensitive-client-id",
    });

    expect(() => service.onModuleInit()).toThrow(
      "Invalid personal data integration configuration"
    );
    try {
      service.onModuleInit();
    } catch (error) {
      expect(String(error)).not.toContain("synthetic-sensitive-client-id");
    }
  });

  it("accepts complete Calendar provider configuration only when Calendar is enabled", () => {
    const { service } = createService({
      ...validKeys(),
      ...validGoogle(),
      CALENDAR_SYNC_ENABLED: "true",
    });

    expect(() => service.onModuleInit()).not.toThrow();
  });

  it("fails startup closed when event discovery is enabled without an allowlist", () => {
    const { service } = createService({
      ...validKeys(),
      EVENT_DISCOVERY_ENABLED: "true",
    });

    expect(() => service.onModuleInit()).toThrow(
      "Invalid personal data integration configuration"
    );
  });

  it("returns a sanitized 503 boundary for a disabled human integration", () => {
    const { service } = createService();

    let thrown: unknown;
    try {
      service.requireEnabled("calendarSync");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ServiceUnavailableException);
    expect((thrown as ServiceUnavailableException).getResponse()).toEqual({
      statusCode: 503,
      code: "integration_not_configured",
      message: "Integration is not configured",
    });
  });

  it("allows a configured enabled integration through the human endpoint boundary", () => {
    const { service } = createService({
      ...validKeys(),
      LOCATION_INGEST_ENABLED: "true",
    });
    service.onModuleInit();

    expect(() => service.requireEnabled("locationIngest")).not.toThrow();
  });
});
