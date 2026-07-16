import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../auth/auth.guard.js";
import { ApprovalHistoryQueryDto } from "./action-proposal.dto.js";
import { ActionProposalService } from "./action-proposal.service.js";

interface AuthenticatedRequest {
  user: { userId: string };
}

@ApiTags("agent-proposals")
@ApiBearerAuth()
@Controller("agent-proposals")
@UseGuards(AuthGuard)
export class ApprovalController {
  constructor(private readonly proposals: ActionProposalService) {}

  @Get()
  list(@Request() request: AuthenticatedRequest) {
    return this.proposals.listPending(request.user.userId);
  }

  @Get("history")
  history(
    @Request() request: AuthenticatedRequest,
    @Query() query: ApprovalHistoryQueryDto
  ) {
    return this.proposals.listHistory(request.user.userId, query);
  }

  @Post(":proposalId/approve")
  approve(
    @Request() request: AuthenticatedRequest,
    @Param("proposalId") proposalId: string
  ) {
    return this.proposals.approve(request.user.userId, proposalId);
  }

  @Post(":proposalId/reject")
  reject(
    @Request() request: AuthenticatedRequest,
    @Param("proposalId") proposalId: string
  ) {
    return this.proposals.reject(request.user.userId, proposalId);
  }
}
