import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Request, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { ContactsService } from './contacts.service.js';
import { CreateContactDto, UpdateContactDto, ContactQueryDto } from './contacts.dto.js';
import { AuthGuard } from '../auth/auth.guard.js';
import {
  CreateContactInteractionDto,
  CreateInteractionDto,
} from '../interactions/interactions.dto.js';
import { InteractionsService } from '../interactions/interactions.service.js';
import { requireHumanIdempotencyKey } from '../../common/human-idempotency.service.js';

@ApiTags('contacts')
@Controller('contacts')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class ContactsController {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly interactionsService: InteractionsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new contact' })
  async create(
    @Request() req: { user: { userId: string } },
    @Body() dto: CreateContactDto,
  ) {
    return this.contactsService.create(req.user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all contacts with filters' })
  async findAll(
    @Request() req: { user: { userId: string } },
    @Query() query: ContactQueryDto,
  ) {
    return this.contactsService.findAll(req.user.userId, query);
  }

  @Get('labels')
  @ApiOperation({ summary: 'Get all unique labels' })
  async getLabels(@Request() req: { user: { userId: string } }) {
    return this.contactsService.getLabels(req.user.userId);
  }

  @Get('tags')
  @ApiOperation({ summary: 'Get all unique tags' })
  async getTags(@Request() req: { user: { userId: string } }) {
    return this.contactsService.getTags(req.user.userId);
  }

  @Get('groups')
  @ApiOperation({ summary: 'Get all unique groups' })
  async getGroups(@Request() req: { user: { userId: string } }) {
    return this.contactsService.getGroups(req.user.userId);
  }

  @Get('due')
  @ApiOperation({ summary: 'Get contacts needing follow-up (stale contacts)' })
  async getDueContacts(
    @Request() req: { user: { userId: string } },
    @Query('days') days?: number,
    @Query('limit') limit?: number,
  ) {
    return this.contactsService.getDueContacts(req.user.userId, days, limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a contact by ID' })
  async findOne(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.contactsService.findOne(req.user.userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a contact' })
  async update(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contactsService.update(req.user.userId, id, dto);
  }

  @Post(':id/interactions')
  @ApiOperation({ summary: 'Log an interaction for a contact' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async createInteraction(
    @Request() req: { user: { userId: string } },
    @Param('id') contactId: string,
    @Body() dto: CreateContactInteractionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const interaction: CreateInteractionDto = { ...dto, contactId };
    return this.interactionsService.create(
      req.user.userId,
      interaction,
      requireHumanIdempotencyKey(idempotencyKey),
    );
  }

  @Get(':id/interactions')
  @ApiOperation({ summary: 'Get interaction history for a contact' })
  async getInteractions(
    @Request() req: { user: { userId: string } },
    @Param('id') contactId: string,
    @Query('limit') limit?: number,
  ) {
    return this.interactionsService.findByContact(
      req.user.userId,
      contactId,
      limit,
    );
  }
}
