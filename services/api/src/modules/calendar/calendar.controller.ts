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
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { Request as ExpressRequest, Response } from "express";
import { AuthGuard } from "../auth/auth.guard.js";
import { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import { CalendarConnectionService } from "./calendar-connection.service.js";
import {
  type AuthenticatedCalendarRequest,
  ConnectCalendarDto,
  UpdateCalendarSourceDto,
  parseGoogleOAuthCallbackQuery,
} from "./calendar.dto.js";
import {
  CalendarWatchService,
  parseWebhookHeaders,
} from "./calendar-watch.service.js";

@ApiTags("calendar-connection")
@ApiBearerAuth()
@Controller("integrations/google-calendar")
@UseGuards(AuthGuard)
export class CalendarConnectionController {
  constructor(private readonly connections: CalendarConnectionService) {}

  @Post("connect")
  connect(
    @Request() request: AuthenticatedCalendarRequest,
    @Body() _input: ConnectCalendarDto
  ) {
    return this.connections.connect(request.user.userId);
  }

  @Get()
  summary(@Request() request: AuthenticatedCalendarRequest) {
    return this.connections.summary(request.user.userId);
  }

  @Get("sources")
  sources(@Request() request: AuthenticatedCalendarRequest) {
    return this.connections.listSources(request.user.userId);
  }

  @Patch("calendars/:sourceId")
  @HttpCode(HttpStatus.NO_CONTENT)
  updateSource(
    @Request() request: AuthenticatedCalendarRequest,
    @Param("sourceId") sourceId: string,
    @Body() input: UpdateCalendarSourceDto
  ): Promise<void> {
    return this.connections.updateSource(request.user.userId, sourceId, input);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  disconnect(@Request() request: AuthenticatedCalendarRequest): Promise<void> {
    return this.connections.disconnect(request.user.userId);
  }
}

@ApiTags("calendar-webhook")
@Controller("integrations/google-calendar")
export class GoogleCalendarWebhookController {
  constructor(
    private readonly watches: CalendarWatchService,
    private readonly config: PersonalDataConfigService
  ) {}

  @Post("webhook")
  @HttpCode(HttpStatus.NO_CONTENT)
  async webhook(
    @Req() request: Pick<ExpressRequest, "headers">
  ): Promise<void> {
    this.config.requireEnabled("calendarSync");
    const input = parseWebhookHeaders(
      request.headers as Record<string, string | string[] | undefined>
    );
    await this.watches.handleWebhook(input);
  }
}

@ApiTags("calendar-oauth")
@Controller("integrations/google-calendar")
export class GoogleCalendarCallbackController {
  constructor(
    private readonly connections: CalendarConnectionService,
    private readonly config: PersonalDataConfigService
  ) {}

  @Get("callback")
  async callback(
    @Req() request: Pick<ExpressRequest, "query">,
    @Res() response: Response
  ): Promise<void> {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    this.config.requireEnabled("calendarSync");
    const resultUrl = this.connections.callbackResultUrl();
    let result: "connected" | "error" = "error";
    try {
      const input = parseGoogleOAuthCallbackQuery(request.query);
      result = await this.connections.handleCallback(input);
    } catch {
      result = "error";
    }

    const redirect = new URL(resultUrl);
    redirect.searchParams.set("calendar", result);
    response.redirect(HttpStatus.SEE_OTHER, redirect.toString());
  }
}
