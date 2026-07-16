import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './health/health.controller.js';
import { PrismaService } from './modules/prisma/prisma.service.js';
import { JwtService } from './modules/jwt/jwt.service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthService } from './modules/auth/auth.service.js';
import { AuthGuard } from './modules/auth/auth.guard.js';
import { ContactsController } from './modules/contacts/contacts.controller.js';
import { ContactsService } from './modules/contacts/contacts.service.js';
import { InteractionsController } from './modules/interactions/interactions.controller.js';
import { InteractionsService } from './modules/interactions/interactions.service.js';
import { RemindersController } from './modules/reminders/reminders.controller.js';
import { RemindersModule } from './modules/reminders/reminders.module.js';
import { GamificationController } from './modules/gamification/gamification.controller.js';
import { GamificationService } from './modules/gamification/gamification.service.js';
import { CelebrationsController } from './modules/celebrations/celebrations.controller.js';
import { CelebrationsService } from './modules/celebrations/celebrations.service.js';
import { DungeonMasterController } from './modules/dungeon-master/dungeon-master.controller.js';
import { DungeonMasterService } from './modules/dungeon-master/dungeon-master.service.js';
import { AiDmService } from './modules/dungeon-master/ai-dm.service.js';
import { AgentsModule } from './modules/agents/agents.module.js';
import { AiAgentModule } from './modules/ai-agent/ai-agent.module.js';
import { AgentToolsModule } from './modules/agent-tools/agent-tools.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { NotificationSchedulerModule } from './modules/notifications/notification-scheduler.module.js';
import { BriefsModule } from './modules/briefs/briefs.module.js';
import { AgentAuthModule } from './modules/agent-auth/agent-auth.module.js';
import { AgentSecurityModule } from './modules/agent-security/agent-security.module.js';
import { McpModule } from './modules/mcp/mcp.module.js';
import { PersonalDataModule } from './modules/personal-data/personal-data.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    AgentsModule,
    NotificationsModule,
    NotificationSchedulerModule,
    AiAgentModule,
    RemindersModule,
    AgentToolsModule,
    BriefsModule,
    AgentAuthModule,
    AgentSecurityModule,
    McpModule,
    PersonalDataModule,
  ],
  controllers: [
    HealthController,
    AuthController,
    ContactsController,
    InteractionsController,
    RemindersController,
    GamificationController,
    CelebrationsController,
    DungeonMasterController,
  ],
  providers: [
    PrismaService,
    JwtService,
    AuthService,
    AuthGuard,
    ContactsService,
    InteractionsService,
    GamificationService,
    CelebrationsService,
    DungeonMasterService,
    AiDmService,
  ],
})
export class AppModule {}
