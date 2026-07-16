import {
  Injectable,
  type OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PersonalDataCipherService } from "./personal-data-cipher.service.js";
import { PersonalDataIndexService } from "./personal-data-index.service.js";
import { parseAllowedEventHosts } from "../events/event-source-policy.js";

export type PersonalDataFeature =
  | "calendarSync"
  | "locationIngest"
  | "eventDiscovery"
  | "eventBrief";

const FEATURE_ENV: Readonly<Record<PersonalDataFeature, string>> = {
  calendarSync: "CALENDAR_SYNC_ENABLED",
  locationIngest: "LOCATION_INGEST_ENABLED",
  eventDiscovery: "EVENT_DISCOVERY_ENABLED",
  eventBrief: "EVENT_BRIEF_ENABLED",
};

const GOOGLE_CALENDAR_CONFIGURATION = [
  "GOOGLE_CALENDAR_CLIENT_ID",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
  "GOOGLE_CALENDAR_REDIRECT_URI",
  "GOOGLE_CALENDAR_WEBHOOK_URL",
  "GOOGLE_CALENDAR_SETTINGS_RESULT_URL",
] as const;

const INTEGRATION_CONFIGURATION_ERROR =
  "Invalid personal data integration configuration";

@Injectable()
export class PersonalDataConfigService implements OnModuleInit {
  constructor(
    private readonly configService: ConfigService,
    private readonly cipher: PersonalDataCipherService,
    private readonly index: PersonalDataIndexService
  ) {}

  isEnabled(feature: PersonalDataFeature): boolean {
    return this.configService.get(FEATURE_ENV[feature]) === "true";
  }

  onModuleInit(): void {
    const enabledFeatures = (
      Object.keys(FEATURE_ENV) as PersonalDataFeature[]
    ).filter((feature) => this.isEnabled(feature));
    if (enabledFeatures.length === 0) return;

    this.cipher.validateConfiguration();
    this.index.validateConfiguration();

    if (enabledFeatures.includes("calendarSync")) {
      this.requireConfiguredValues(GOOGLE_CALENDAR_CONFIGURATION);
    }
    if (enabledFeatures.includes("eventDiscovery")) {
      this.requireConfiguredValues(["EVENT_SOURCE_ALLOWED_HOSTS"]);
      try {
        parseAllowedEventHosts(
          this.configService.get<string>("EVENT_SOURCE_ALLOWED_HOSTS")
        );
      } catch {
        throw new Error(INTEGRATION_CONFIGURATION_ERROR);
      }
    }
  }

  requireEnabled(feature: PersonalDataFeature): void {
    if (this.isEnabled(feature)) return;

    throw new ServiceUnavailableException({
      statusCode: 503,
      code: "integration_not_configured",
      message: "Integration is not configured",
    });
  }

  private requireConfiguredValues(names: readonly string[]): void {
    const valid = names.every((name) => {
      const value = this.configService.get(name);
      return typeof value === "string" && value.trim().length > 0;
    });
    if (!valid) throw new Error(INTEGRATION_CONFIGURATION_ERROR);
  }
}
