import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DungeonMasterService } from './dungeon-master.service.js';
import { CreateSessionDto, SubmitResponseDto } from './dungeon-master.dto.js';
import { AuthGuard } from '../auth/auth.guard.js';

@ApiTags('dm')
@Controller('dm')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class DungeonMasterController {
  constructor(private readonly dmService: DungeonMasterService) {}

  @Get('scenarios')
  @ApiOperation({ summary: 'List all available scenario archetypes' })
  async listScenarios() {
    return this.dmService.listScenarios();
  }

  @Post('sessions')
  @ApiOperation({ summary: 'Create a new DM session between two matched users' })
  async createSession(
    @Request() req: { user: { userId: string } },
    @Body() dto: CreateSessionDto,
  ) {
    return this.dmService.createSession(dto, req.user.userId);
  }

  @Post('sessions/:id/accept')
  @ApiOperation({ summary: 'Accept a pending DM session invitation' })
  async acceptSession(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.dmService.acceptSession(id, req.user.userId);
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Get session state + current scene' })
  async getSession(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.dmService.getSession(id, req.user.userId);
  }

  @Post('sessions/:id/begin')
  @ApiOperation({ summary: 'Begin the next scene (generate AI narration)' })
  async beginScene(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.dmService.beginScene(id, req.user.userId);
  }

  @Post('sessions/:id/respond')
  @ApiOperation({ summary: 'Submit a response for the current scene' })
  async submitResponse(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
    @Body() dto: SubmitResponseDto,
  ) {
    return this.dmService.submitResponse(id, req.user.userId, dto);
  }

  @Post('sessions/:id/advance')
  @ApiOperation({ summary: 'Advance to next scene (after AI synthesis)' })
  async advanceScene(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.dmService.advanceScene(id, req.user.userId);
  }

  @Get('sessions/:id/debrief')
  @ApiOperation({ summary: 'Get AI debrief + award XP' })
  async getDebrief(
    @Request() req: { user: { userId: string } },
    @Param('id') id: string,
  ) {
    return this.dmService.getDebrief(id, req.user.userId);
  }
}
