import { Module } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { JwtService } from "../jwt/jwt.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { AgentAuthController } from "./agent-auth.controller.js";
import { AgentAuthGuard } from "./agent-auth.guard.js";
import { AgentAuthService } from "./agent-auth.service.js";

@Module({
  controllers: [AgentAuthController],
  providers: [
    PrismaService,
    JwtService,
    AuthGuard,
    AgentAuthService,
    AgentAuthGuard,
  ],
  exports: [AgentAuthService, AgentAuthGuard],
})
export class AgentAuthModule {}
