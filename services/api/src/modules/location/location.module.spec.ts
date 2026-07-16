import { MODULE_METADATA } from "@nestjs/common/constants";
import { AuthGuard } from "../auth/auth.guard.js";
import { JwtService } from "../jwt/jwt.service.js";
import { PersonalDataModule } from "../personal-data/personal-data.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  LocationAliasController,
  LocationContextController,
  LocationDeviceController,
  OwnTracksController,
} from "./location.controller.js";
import { LocationAliasService } from "./location-alias.service.js";
import { LocationContextService } from "./location-context.service.js";
import { LocationDeviceService } from "./location-device.service.js";
import { LocationIngestService } from "./location-ingest.service.js";
import { LocationModule } from "./location.module.js";
import { LocationRetentionService } from "./location-retention.service.js";
import { OwnTracksAuthGuard } from "./owntracks-auth.guard.js";
import { VisitDerivationService } from "./visit-derivation.service.js";

describe("LocationModule", () => {
  it("owns the location HTTP and service dependency graph", () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      LocationModule
    );
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      LocationModule
    );
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      LocationModule
    );

    expect(imports).toContain(PersonalDataModule);
    expect(controllers).toEqual([
      LocationDeviceController,
      LocationAliasController,
      LocationContextController,
      OwnTracksController,
    ]);
    expect(providers).toEqual(
      expect.arrayContaining([
        PrismaService,
        JwtService,
        AuthGuard,
        LocationDeviceService,
        LocationIngestService,
        VisitDerivationService,
        LocationAliasService,
        LocationContextService,
        LocationRetentionService,
        OwnTracksAuthGuard,
      ])
    );
    expect(
      Reflect.getMetadata(MODULE_METADATA.EXPORTS, LocationModule)
    ).toEqual(
      expect.arrayContaining([LocationAliasService, LocationContextService])
    );
  });
});
