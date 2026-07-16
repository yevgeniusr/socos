import { Module } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { JwtService } from "../jwt/jwt.service.js";
import { PersonalDataModule } from "../personal-data/personal-data.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  LocationDeviceController,
  OwnTracksController,
} from "./location.controller.js";
import { LocationDeviceService } from "./location-device.service.js";
import { LocationIngestService } from "./location-ingest.service.js";
import { OwnTracksAuthGuard } from "./owntracks-auth.guard.js";

@Module({
  imports: [PersonalDataModule],
  controllers: [LocationDeviceController, OwnTracksController],
  providers: [
    PrismaService,
    JwtService,
    AuthGuard,
    LocationDeviceService,
    LocationIngestService,
    OwnTracksAuthGuard,
  ],
})
export class LocationModule {}
