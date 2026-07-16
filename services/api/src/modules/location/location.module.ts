import { Module } from "@nestjs/common";
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
import { LocationRetentionService } from "./location-retention.service.js";
import { OwnTracksAuthGuard } from "./owntracks-auth.guard.js";
import { VisitDerivationService } from "./visit-derivation.service.js";

@Module({
  imports: [PersonalDataModule],
  controllers: [
    LocationDeviceController,
    LocationAliasController,
    LocationContextController,
    OwnTracksController,
  ],
  providers: [
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
  ],
  exports: [LocationAliasService, LocationContextService],
})
export class LocationModule {}
