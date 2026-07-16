import { randomBytes, randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import cuid from "cuid";
import { google } from "googleapis";
import { AuthGuard } from "../auth/auth.guard.js";
import { JwtService } from "../jwt/jwt.service.js";
import { PersonalDataModule } from "../personal-data/personal-data.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LocationModule } from "../location/location.module.js";
import { CalendarConnectionService } from "./calendar-connection.service.js";
import {
  CalendarConnectionController,
  GoogleCalendarCallbackController,
  GoogleCalendarWebhookController,
} from "./calendar.controller.js";
import { CalendarSchedulerService } from "./calendar-scheduler.service.js";
import {
  CALENDAR_SYNC_ID_GENERATOR,
  CalendarSyncService,
  GOOGLE_CALENDAR_PROVIDER,
  GoogleApisCalendarProvider,
} from "./calendar-sync.service.js";
import {
  CALENDAR_WATCH_TOKEN_GENERATOR,
  CalendarWatchService,
} from "./calendar-watch.service.js";
import {
  CALENDAR_ID_GENERATOR,
  GOOGLE_OAUTH_CLIENT_FACTORY,
  GoogleOAuthService,
  type GoogleOAuthClientFactory,
} from "./google-oauth.service.js";

const googleOAuthClientFactory: GoogleOAuthClientFactory = ({
  clientId,
  clientSecret,
  redirectUri,
}) => {
  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  return {
    generateAuthUrl: (options) =>
      client.generateAuthUrl({
        ...options,
        scope: [...options.scope],
        code_challenge_method: options.code_challenge_method as NonNullable<
          Parameters<typeof client.generateAuthUrl>[0]["code_challenge_method"]
        >,
      }),
    getToken: (options) => client.getToken(options),
    getTokenInfo: (accessToken) => client.getTokenInfo(accessToken),
  };
};

@Module({
  imports: [ConfigModule, PersonalDataModule, LocationModule],
  controllers: [
    CalendarConnectionController,
    GoogleCalendarCallbackController,
    GoogleCalendarWebhookController,
  ],
  providers: [
    PrismaService,
    JwtService,
    AuthGuard,
    GoogleOAuthService,
    CalendarConnectionService,
    CalendarSyncService,
    CalendarWatchService,
    CalendarSchedulerService,
    GoogleApisCalendarProvider,
    {
      provide: GOOGLE_CALENDAR_PROVIDER,
      useExisting: GoogleApisCalendarProvider,
    },
    {
      provide: GOOGLE_OAUTH_CLIENT_FACTORY,
      useValue: googleOAuthClientFactory,
    },
    { provide: CALENDAR_ID_GENERATOR, useValue: cuid },
    { provide: CALENDAR_SYNC_ID_GENERATOR, useValue: randomUUID },
    {
      provide: CALENDAR_WATCH_TOKEN_GENERATOR,
      useValue: () => randomBytes(32).toString("base64url"),
    },
  ],
  exports: [
    CalendarConnectionService,
    CalendarSyncService,
    CalendarWatchService,
  ],
})
export class CalendarModule {}
