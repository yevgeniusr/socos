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
  Put,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard.js";
import { EventPreferenceService } from "./event-preference.service.js";
import { EventCatalogService } from "./event-catalog.service.js";
import {
  EventCatalogQueryDto,
  PatchEventCatalogFollowDto,
  PutEventCatalogFollowDto,
} from "./event-catalog.dto.js";
import { EventSourceService } from "./event-source.service.js";
import {
  type AuthenticatedEventRequest,
  CreateEventSourceDto,
  UpdateEventSourceDto,
  UpsertEventPreferenceDto,
} from "./events.dto.js";

@ApiTags("event-sources")
@ApiBearerAuth()
@Controller("event-sources")
@UseGuards(AuthGuard)
export class EventSourcesController {
  constructor(private readonly sources: EventSourceService) {}

  @Post()
  create(
    @Request() request: AuthenticatedEventRequest,
    @Body() input: CreateEventSourceDto
  ) {
    return this.sources.create(request.user.userId, input);
  }

  @Get()
  list(@Request() request: AuthenticatedEventRequest) {
    return this.sources.list(request.user.userId);
  }

  @Patch(":sourceId")
  update(
    @Request() request: AuthenticatedEventRequest,
    @Param("sourceId") sourceId: string,
    @Body() input: UpdateEventSourceDto
  ) {
    return this.sources.update(request.user.userId, sourceId, input);
  }

  @Delete(":sourceId")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Request() request: AuthenticatedEventRequest,
    @Param("sourceId") sourceId: string
  ): Promise<void> {
    return this.sources.remove(request.user.userId, sourceId);
  }
}

@ApiTags("event-preferences")
@ApiBearerAuth()
@Controller("event-preferences")
@UseGuards(AuthGuard)
export class EventPreferencesController {
  constructor(private readonly preferences: EventPreferenceService) {}

  @Get()
  get(@Request() request: AuthenticatedEventRequest) {
    return this.preferences.get(request.user.userId);
  }

  @Put()
  upsert(
    @Request() request: AuthenticatedEventRequest,
    @Body() input: UpsertEventPreferenceDto
  ) {
    return this.preferences.upsert(request.user.userId, input);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Request() request: AuthenticatedEventRequest): Promise<void> {
    return this.preferences.remove(request.user.userId);
  }
}

@ApiTags("event-catalog")
@ApiBearerAuth()
@Controller("event-catalog")
@UseGuards(AuthGuard)
export class EventCatalogController {
  constructor(private readonly catalog: EventCatalogService) {}

  @Get()
  search(
    @Request() request: AuthenticatedEventRequest,
    @Query() query: EventCatalogQueryDto
  ) {
    return this.catalog.search(request.user.userId, query);
  }

  @Get(":slug")
  getBySlug(
    @Request() request: AuthenticatedEventRequest,
    @Param("slug") slug: string
  ) {
    return this.catalog.getBySlug(request.user.userId, slug);
  }

  @Put(":slug/follow")
  putFollow(
    @Request() request: AuthenticatedEventRequest,
    @Param("slug") slug: string,
    @Body() input: PutEventCatalogFollowDto
  ) {
    return this.catalog.putFollow(request.user.userId, slug, input);
  }

  @Patch(":slug/follow")
  patchFollow(
    @Request() request: AuthenticatedEventRequest,
    @Param("slug") slug: string,
    @Body() input: PatchEventCatalogFollowDto
  ) {
    return this.catalog.patchFollow(request.user.userId, slug, input);
  }
}
