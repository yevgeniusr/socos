import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard.js";
import {
  type AuthenticatedLocationDevice,
  type AuthenticatedOwnerRequest,
  CreateLocationDeviceDto,
  OwnTracksLocationDto,
} from "./location.dto.js";
import { LocationDeviceService } from "./location-device.service.js";
import { LocationIngestService } from "./location-ingest.service.js";
import { OwnTracksAuthGuard } from "./owntracks-auth.guard.js";

@ApiTags("location-devices")
@ApiBearerAuth()
@Controller("location-devices")
@UseGuards(AuthGuard)
export class LocationDeviceController {
  constructor(private readonly devices: LocationDeviceService) {}

  @Post()
  create(
    @Request() request: AuthenticatedOwnerRequest,
    @Body() input: CreateLocationDeviceDto
  ) {
    return this.devices.create(request.user.userId, input);
  }

  @Get()
  list(@Request() request: AuthenticatedOwnerRequest) {
    return this.devices.list(request.user.userId);
  }

  @Post(":deviceId/rotate")
  rotate(
    @Request() request: AuthenticatedOwnerRequest,
    @Param("deviceId") deviceId: string
  ) {
    return this.devices.rotate(request.user.userId, deviceId);
  }

  @Delete(":deviceId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Request() request: AuthenticatedOwnerRequest,
    @Param("deviceId") deviceId: string
  ): Promise<void> {
    await this.devices.revoke(request.user.userId, deviceId);
  }
}

type OwnTracksRequest = { locationDevice: AuthenticatedLocationDevice };

@ApiTags("location")
@Controller("location")
export class OwnTracksController {
  constructor(private readonly locationIngest: LocationIngestService) {}

  @Post("owntracks")
  @UseGuards(OwnTracksAuthGuard)
  @HttpCode(HttpStatus.OK)
  ingest(
    @Request() request: OwnTracksRequest,
    @Body() input: OwnTracksLocationDto
  ): Promise<[]> {
    return this.locationIngest.ingest(request.locationDevice, input);
  }
}
