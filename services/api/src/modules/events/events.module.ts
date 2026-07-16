import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthGuard } from "../auth/auth.guard.js";
import { JwtService } from "../jwt/jwt.service.js";
import { PersonalDataModule } from "../personal-data/personal-data.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { DnsPinnedFetchService } from "./dns-pinned-fetch.service.js";
import {
  DISCOVERED_EVENT_ID_GENERATOR,
  EVENT_DISCOVERY_CLOCK,
  EventDiscoveryService,
} from "./event-discovery.service.js";
import {
  EVENT_PREFERENCE_ID_GENERATOR,
  EventPreferenceService,
} from "./event-preference.service.js";
import {
  EVENT_EXTERNAL_SOURCE_ID_GENERATOR,
  EVENT_SOURCE_ID_GENERATOR,
  EventSourceService,
} from "./event-source.service.js";
import {
  EventPreferencesController,
  EventSourcesController,
} from "./events.controller.js";
import { IcsEventDiscoveryAdapter } from "./ics-event-discovery.adapter.js";

@Module({
  imports: [ConfigModule, PersonalDataModule],
  controllers: [EventSourcesController, EventPreferencesController],
  providers: [
    PrismaService,
    JwtService,
    AuthGuard,
    EventSourceService,
    EventPreferenceService,
    DnsPinnedFetchService,
    IcsEventDiscoveryAdapter,
    EventDiscoveryService,
    { provide: EVENT_SOURCE_ID_GENERATOR, useValue: randomUUID },
    { provide: EVENT_EXTERNAL_SOURCE_ID_GENERATOR, useValue: randomUUID },
    { provide: EVENT_PREFERENCE_ID_GENERATOR, useValue: randomUUID },
    { provide: DISCOVERED_EVENT_ID_GENERATOR, useValue: randomUUID },
    { provide: EVENT_DISCOVERY_CLOCK, useValue: () => new Date() },
  ],
  exports: [
    EventSourceService,
    EventPreferenceService,
    EventDiscoveryService,
    IcsEventDiscoveryAdapter,
  ],
})
export class EventsModule {}
