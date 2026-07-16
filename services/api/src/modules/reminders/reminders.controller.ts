import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { RemindersService } from './reminders.service.js';
import { CreateReminderDto, UpdateReminderDto, ReminderQueryDto } from './reminders.dto.js';
import { AuthGuard } from '../auth/auth.guard.js';

@ApiTags('reminders')
@Controller('reminders')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new reminder' })
  async create(
    @Request() req: { user: { userId: string } },
    @Body() dto: CreateReminderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return idempotencyKey
      ? this.remindersService.create(req.user.userId, dto, idempotencyKey)
      : this.remindersService.create(req.user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all reminders with filters' })
  async findAll(
    @Request() req: { user: { userId: string } },
    @Query() query: ReminderQueryDto,
  ) {
    return this.remindersService.findAll(req.user.userId, query);
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'Get upcoming reminders' })
  async getUpcoming(@Request() req: { user: { userId: string } }) {
    return this.remindersService.getUpcoming(req.user.userId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a reminder' })
  async update(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() dto: UpdateReminderDto,
  ) {
    return this.remindersService.update(req.user.userId, id, dto);
  }

  @Put(':id/complete')
  @ApiOperation({ summary: 'Mark a reminder as completed' })
  async complete(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.remindersService.complete(req.user.userId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a reminder' })
  async delete(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.remindersService.delete(req.user.userId, id);
  }
}
