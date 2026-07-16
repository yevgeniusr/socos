import { Module } from "@nestjs/common";
import { AuthGuard } from "../auth/auth.guard.js";
import { JwtService } from "../jwt/jwt.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { BriefFeedbackService } from "./brief-feedback.service.js";
import { BriefGeneratorService } from "./brief-generator.service.js";
import { BriefSchedulerService } from "./brief-scheduler.service.js";
import { BriefsController } from "./briefs.controller.js";
import { ImportantDatesService } from "./important-dates.service.js";

@Module({
  controllers: [BriefsController],
  providers: [
    PrismaService,
    JwtService,
    AuthGuard,
    ImportantDatesService,
    BriefGeneratorService,
    BriefFeedbackService,
    BriefSchedulerService,
  ],
  exports: [BriefGeneratorService],
})
export class BriefsModule {}
