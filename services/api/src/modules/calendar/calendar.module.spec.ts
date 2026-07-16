import { MODULE_METADATA } from "@nestjs/common/constants";
import cuid from "cuid";
import { PersonalDataModule } from "../personal-data/personal-data.module.js";
import { CalendarConnectionService } from "./calendar-connection.service.js";
import {
  CalendarConnectionController,
  GoogleCalendarCallbackController,
} from "./calendar.controller.js";
import { CalendarModule } from "./calendar.module.js";
import {
  CALENDAR_ID_GENERATOR,
  GOOGLE_OAUTH_CLIENT_FACTORY,
  GoogleOAuthService,
} from "./google-oauth.service.js";

describe("CalendarModule composition", () => {
  it("owns the guarded human and public callback controllers", () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      CalendarModule
    ) as unknown[];
    expect(controllers).toEqual([
      CalendarConnectionController,
      GoogleCalendarCallbackController,
    ]);
  });

  it("imports personal-data providers and wires OAuth services", () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      CalendarModule
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      CalendarModule
    ) as Array<unknown>;

    expect(imports).toContain(PersonalDataModule);
    expect(providers).toContain(GoogleOAuthService);
    expect(providers).toContain(CalendarConnectionService);
    expect(
      providers.some(
        (provider) =>
          typeof provider === "object" &&
          provider !== null &&
          (provider as { provide?: unknown }).provide ===
            GOOGLE_OAUTH_CLIENT_FACTORY
      )
    ).toBe(true);
  });

  it("generates real CUID records before encryption", () => {
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      CalendarModule
    ) as Array<unknown>;
    const provider = providers.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        (candidate as { provide?: unknown }).provide === CALENDAR_ID_GENERATOR
    ) as { useValue: () => string };

    const first = provider.useValue();
    const second = provider.useValue();
    expect(cuid.isCuid(first)).toBe(true);
    expect(cuid.isCuid(second)).toBe(true);
    expect(second).not.toBe(first);
  });
});
