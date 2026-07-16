import { Module } from "@nestjs/common";
import { CalendarModule } from "../calendar/calendar.module.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { JwtService } from "../jwt/jwt.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { PersonalDataModule } from "./personal-data.module.js";
import { PersonalContextController } from "./personal-context.controller.js";
import { PersonalContextDeletionService } from "./personal-context-deletion.service.js";

@Module({
  imports: [PersonalDataModule, CalendarModule],
  controllers: [PersonalContextController],
  providers: [
    PrismaService,
    JwtService,
    AuthGuard,
    PersonalContextDeletionService,
  ],
})
export class PersonalContextModule {}
