import { MODULE_METADATA } from "@nestjs/common/constants";
import { PersonalDataModule } from "../personal-data/personal-data.module.js";
import { EventDiscoveryService } from "./event-discovery.service.js";
import { EventCatalogService } from "./event-catalog.service.js";
import { EventPreferenceService } from "./event-preference.service.js";
import { EventSourceService } from "./event-source.service.js";
import {
  EventCatalogController,
  EventPreferencesController,
  EventSourcesController,
} from "./events.controller.js";
import { EventsModule } from "./events.module.js";

describe("EventsModule", () => {
  it("owns the event discovery dependency graph", () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, EventsModule);
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      EventsModule
    );
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      EventsModule
    );

    expect(imports).toContain(PersonalDataModule);
    expect(controllers).toEqual([
      EventSourcesController,
      EventPreferencesController,
      EventCatalogController,
    ]);
    expect(providers).toEqual(
      expect.arrayContaining([
        EventSourceService,
        EventPreferenceService,
        EventDiscoveryService,
        EventCatalogService,
      ])
    );
  });
});
