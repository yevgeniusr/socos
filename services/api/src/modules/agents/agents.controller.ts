/**
 * AI Agent System - HTTP Controller
 *
 * Provides REST endpoints for all AI agent operations.
 * All endpoints require bearer authentication.
 */

import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentsService } from './agents.service.js';
import { AuthGuard } from '../auth/auth.guard.js';

type AuthenticatedRequest = { user: { userId: string } };

@ApiTags('Agents')
@Controller('agents')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  // ========== Relationship Agent ==========

  @Get('relationship')
  @ApiOperation({ summary: 'Get relationship recommendations' })
  async getRelationshipRecommendations(
    @Request() req: AuthenticatedRequest,
    @Query('daysStale') daysStale?: string,
    @Query('limit') limit?: string,
  ) {
    const ctx = { userId: req.user.userId };
    return this.agentsService.getRelationshipRecommendations(ctx, {
      daysStale: daysStale ? parseInt(daysStale) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Post('relationship/refresh-scores')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh relationship scores for all contacts' })
  async refreshRelationshipScores(@Request() req: AuthenticatedRequest) {
    const ctx = { userId: req.user.userId };
    return this.agentsService.refreshRelationshipScores(ctx);
  }

  // ========== Reminder Agent ==========

  @Get('reminders/upcoming')
  @ApiOperation({ summary: 'Get upcoming reminders' })
  async getUpcomingReminders(
    @Request() req: AuthenticatedRequest,
    @Query('daysAhead') daysAhead?: string,
    @Query('types') types?: string,
  ) {
    const ctx = { userId: req.user.userId };
    return this.agentsService.getReminderRecommendations(ctx, {
      daysAhead: daysAhead ? parseInt(daysAhead) : undefined,
      types: types ? types.split(',') : undefined,
    });
  }

  @Get('reminders/birthdays')
  @ApiOperation({ summary: 'Suggest birthday reminders' })
  async suggestBirthdayReminders(
    @Request() req: AuthenticatedRequest,
    @Query('daysAhead') daysAhead?: string,
  ) {
    const ctx = { userId: req.user.userId };
    return this.agentsService.suggestBirthdayReminders(ctx, {
      daysAhead: daysAhead ? parseInt(daysAhead) : undefined,
    });
  }

  @Get('reminders/stale')
  @ApiOperation({ summary: 'Suggest reminders for stale contacts' })
  async suggestStaleContactReminders(
    @Request() req: AuthenticatedRequest,
    @Query('staleDays') staleDays?: string,
    @Query('limit') limit?: string,
  ) {
    const ctx = { userId: req.user.userId };
    return this.agentsService.suggestStaleContactReminders(ctx, {
      staleDays: staleDays ? parseInt(staleDays) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Post('reminders/sync-celebrations')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sync celebration dates to reminders' })
  async syncCelebrationReminders(@Request() req: AuthenticatedRequest) {
    const ctx = { userId: req.user.userId };
    return this.agentsService.syncCelebrationReminders(ctx);
  }

  // ========== Enrichment Agent ==========

  @Post('enrich/batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch enrich contacts' })
  async enrichContacts(
    @Request() req: AuthenticatedRequest,
    @Body() body: { contactIds?: string[]; limit?: number },
  ) {
    const ctx = { userId: req.user.userId };
    return this.agentsService.enrichContacts(ctx, body);
  }

  @Post('enrich/:contactId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enrich contact with additional data' })
  async enrichContact(
    @Request() req: AuthenticatedRequest,
    @Param('contactId') contactId: string,
  ) {
    const ctx = { userId: req.user.userId, contactId };
    return this.agentsService.enrichContact(ctx);
  }

  @Post('enrich/:contactId/apply')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Legacy direct enrichment apply (disabled)' })
  async applyEnrichment(
    @Request() req: AuthenticatedRequest,
    @Param('contactId') contactId: string,
    @Body()
    body: {
      photo?: string;
      bio?: string;
      company?: string;
      jobTitle?: string;
      socialLinks?: Record<string, string>;
    },
  ) {
    const ctx = { userId: req.user.userId, contactId };
    return this.agentsService.applyEnrichment(ctx, body);
  }

  // ========== Summary Agent ==========

  @Get('summary/interaction/:interactionId')
  @ApiOperation({ summary: 'Summarize a single interaction' })
  async summarizeInteraction(
    @Request() req: AuthenticatedRequest,
    @Param('interactionId') interactionId: string,
  ) {
    const ctx = { userId: req.user.userId, interactionId };
    return this.agentsService.summarizeInteraction(ctx);
  }

  @Get('summary/contact/:contactId')
  @ApiOperation({ summary: 'Summarize contact history' })
  async summarizeContactHistory(
    @Request() req: AuthenticatedRequest,
    @Param('contactId') contactId: string,
    @Query('limit') limit?: string,
    @Query('daysBack') daysBack?: string,
  ) {
    const ctx = { userId: req.user.userId, contactId };
    return this.agentsService.summarizeContactHistory(ctx, {
      limit: limit ? parseInt(limit) : undefined,
      daysBack: daysBack ? parseInt(daysBack) : undefined,
    });
  }

  @Get('summary/activity')
  @ApiOperation({ summary: 'Summarize activity for a period' })
  async summarizeActivityPeriod(
    @Request() req: AuthenticatedRequest,
    @Query('period') period?: 'week' | 'month',
  ) {
    const ctx = { userId: req.user.userId };
    return this.agentsService.summarizeActivityPeriod(ctx, { period });
  }

  // ========== Suggestion Agent ==========

  @Get('suggestions')
  @ApiOperation({ summary: 'Get suggested contacts to meet' })
  async getSuggestions(
    @Request() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('reason') reason?: 'interests' | 'mutual' | 'stale' | 'nearby',
  ) {
    const ctx = { userId: req.user.userId };
    return this.agentsService.getSuggestions(ctx, {
      limit: limit ? parseInt(limit) : undefined,
      reason,
    });
  }

  @Get('suggestions/introductions')
  @ApiOperation({ summary: 'Get suggested warm introductions' })
  async suggestIntroductions(
    @Request() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
  ) {
    const ctx = { userId: req.user.userId };
    return this.agentsService.suggestIntroductions(ctx, {
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('suggestions/score-improvement')
  @ApiOperation({ summary: 'Get contacts that could improve relationship score' })
  async suggestScoreImprovement(
    @Request() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
  ) {
    const ctx = { userId: req.user.userId };
    return this.agentsService.suggestScoreImprovement(ctx, {
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  // ========== Dashboard ==========

  @Get('dashboard')
  @ApiOperation({ summary: 'Get full agent dashboard data' })
  async getDashboard(@Request() req: AuthenticatedRequest) {
    const ctx = { userId: req.user.userId };
    return this.agentsService.getDashboard(ctx);
  }
}
