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
import { CreateAgentClientDto } from "./agent-auth.dto.js";
import { AgentAuthService } from "./agent-auth.service.js";

interface AuthenticatedRequest {
  user: { userId: string };
}

@ApiTags("agent-clients")
@ApiBearerAuth()
@Controller("agent-clients")
@UseGuards(AuthGuard)
export class AgentAuthController {
  constructor(private readonly agentAuth: AgentAuthService) {}

  @Post()
  create(
    @Request() request: AuthenticatedRequest,
    @Body() input: CreateAgentClientDto
  ) {
    return this.agentAuth.createClient(request.user.userId, {
      name: input.name,
      scopes: input.scopes,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
    });
  }

  @Get()
  list(@Request() request: AuthenticatedRequest) {
    return this.agentAuth.listClients(request.user.userId);
  }

  @Post(":clientId/rotate")
  rotate(
    @Request() request: AuthenticatedRequest,
    @Param("clientId") clientId: string
  ) {
    return this.agentAuth.rotateClient(request.user.userId, clientId);
  }

  @Delete(":clientId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Request() request: AuthenticatedRequest,
    @Param("clientId") clientId: string
  ): Promise<void> {
    await this.agentAuth.revokeClient(request.user.userId, clientId);
  }
}
