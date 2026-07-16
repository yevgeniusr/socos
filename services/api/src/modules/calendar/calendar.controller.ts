import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  parseGoogleOAuthCallbackQuery,
} from "./calendar.dto.js";

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

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  disconnect(@Request() request: AuthenticatedCalendarRequest): Promise<void> {
    return this.connections.disconnect(request.user.userId);
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
    const resultUrl = this.connections.callbackResultUrl();
    let result: "connected" | "error" = "error";
    try {
      this.config.requireEnabled("calendarSync");
      const input = parseGoogleOAuthCallbackQuery(request.query);
      result = await this.connections.handleCallback(input);
    } catch {
      result = "error";
    }

    const redirect = new URL(resultUrl);
    redirect.searchParams.set("calendar", result);
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Pragma", "no-cache");
    response.redirect(HttpStatus.SEE_OTHER, redirect.toString());
  }
}
