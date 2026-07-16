import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, Request, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InteractionsService } from './interactions.service.js';
import { CreateInteractionDto, InteractionQueryDto } from './interactions.dto.js';
import { AuthGuard } from '../auth/auth.guard.js';

@ApiTags('interactions')
@Controller('interactions')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class InteractionsController {
  constructor(private readonly interactionsService: InteractionsService) {}

  @Post()
  @ApiOperation({ summary: 'Log a new interaction' })
  async create(
    @Request() req: { user: { userId: string } },
    @Body() dto: CreateInteractionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return idempotencyKey
      ? this.interactionsService.create(req.user.userId, dto, idempotencyKey)
      : this.interactionsService.create(req.user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all interactions with filters' })
  async findAll(
    @Request() req: { user: { userId: string } },
    @Query() query: InteractionQueryDto,
  ) {
    return this.interactionsService.findAll(req.user.userId, query);
  }

  @Get('timeline')
  @ApiOperation({ summary: 'Get interaction timeline' })
  async getTimeline(
    @Request() req: { user: { userId: string } },
    @Query('limit') limit?: number,
  ) {
    return this.interactionsService.getTimeline(req.user.userId, limit);
  }

  @Get('contact/:contactId')
  @ApiOperation({ summary: 'Get interactions for a specific contact' })
  async getByContact(
    @Request() req: { user: { userId: string } },
    @Param('contactId') contactId: string,
    @Query('limit') limit?: number,
  ) {
    return this.interactionsService.findByContact(req.user.userId, contactId, limit);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an interaction' })
  async delete(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.interactionsService.delete(req.user.userId, id);
  }
}
