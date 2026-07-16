import { Module } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { JwtService } from "../jwt/jwt.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ActionProposalService } from "./action-proposal.service.js";
import { AgentAuditService } from "./agent-audit.service.js";
import { AgentIdempotencyService } from "./agent-idempotency.service.js";
import {
  APPROVED_ACTION_EXECUTORS,
  ApprovedActionExecutionService,
} from "./approved-action-execution.service.js";
import { ApprovalController } from "./approval.controller.js";

@Module({
  controllers: [ApprovalController],
  providers: [
    PrismaService,
    JwtService,
    AuthGuard,
    ActionProposalService,
    AgentAuditService,
    AgentIdempotencyService,
    ApprovedActionExecutionService,
    { provide: APPROVED_ACTION_EXECUTORS, useValue: new Map() },
  ],
  exports: [
    ActionProposalService,
    AgentAuditService,
    AgentIdempotencyService,
    ApprovedActionExecutionService,
  ],
})
export class AgentSecurityModule {}
