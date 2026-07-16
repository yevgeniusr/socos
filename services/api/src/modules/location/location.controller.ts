import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
  CreateLocationAliasDto,
  OwnTracksLocationDto,
  UpdateLocationAliasDto,
} from "./location.dto.js";
import { LocationAliasService } from "./location-alias.service.js";
import { LocationContextService } from "./location-context.service.js";
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

@ApiTags("location-aliases")
@ApiBearerAuth()
@Controller("location-aliases")
@UseGuards(AuthGuard)
export class LocationAliasController {
  constructor(private readonly aliases: LocationAliasService) {}

  @Post()
  create(
    @Request() request: AuthenticatedOwnerRequest,
    @Body() input: CreateLocationAliasDto
  ) {
    return this.aliases.create(request.user.userId, input);
  }

  @Get()
  list(@Request() request: AuthenticatedOwnerRequest) {
    return this.aliases.list(request.user.userId);
  }

  @Patch(":aliasId")
  update(
    @Request() request: AuthenticatedOwnerRequest,
    @Param("aliasId") aliasId: string,
    @Body() input: UpdateLocationAliasDto
  ) {
    return this.aliases.update(request.user.userId, aliasId, input);
  }

  @Delete(":aliasId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Request() request: AuthenticatedOwnerRequest,
    @Param("aliasId") aliasId: string
  ): Promise<void> {
    await this.aliases.remove(request.user.userId, aliasId);
  }
}

@ApiTags("location-context")
@ApiBearerAuth()
@Controller("location-context")
@UseGuards(AuthGuard)
export class LocationContextController {
  constructor(private readonly context: LocationContextService) {}

  @Get("current")
  async current(@Request() request: AuthenticatedOwnerRequest) {
    const value = await this.context.current(request.user.userId);
    return {
      source: value.source,
      city: value.city,
      countryCode: value.countryCode,
      timeZone: value.timeZone,
      distanceCapability: value.distanceCapability,
      lastSeenAt: value.lastSeenAt,
    };
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
