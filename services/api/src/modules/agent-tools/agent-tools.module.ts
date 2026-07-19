import { Module } from "@nestjs/common";
import { AgentSecurityModule } from "../agent-security/agent-security.module.js";
import { BriefFeedbackService } from "../briefs/brief-feedback.service.js";
import { BriefsModule } from "../briefs/briefs.module.js";
import { ImportantDatesService } from "../briefs/important-dates.service.js";
import { GamificationService } from "../gamification/gamification.service.js";
import { InteractionsService } from "../interactions/interactions.service.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RemindersModule } from "../reminders/reminders.module.js";
import { RemindersService } from "../reminders/reminders.service.js";
import { ContactEnrichmentService } from "../contact-enrichment/contact-enrichment.service.js";
import { ContactsService } from "../contacts/contacts.service.js";
import { AgentReadService } from "./agent-read.service.js";
import {
  AGENT_FEEDBACK_COMMANDS,
  AGENT_CONTACT_COMMANDS,
  AGENT_INTERACTION_COMMANDS,
  AGENT_REMINDER_COMMANDS,
  AgentToolHandlers,
} from "./tool-handlers.js";
import { AgentToolRegistryService } from "./tool-registry.service.js";

@Module({
  imports: [
    AgentSecurityModule,
    BriefsModule,
    NotificationsModule,
    RemindersModule,
  ],
  providers: [
    PrismaService,
    ImportantDatesService,
    BriefFeedbackService,
    GamificationService,
    InteractionsService,
    ContactEnrichmentService,
    ContactsService,
    AgentReadService,
    AgentToolHandlers,
    AgentToolRegistryService,
    { provide: AGENT_CONTACT_COMMANDS, useExisting: ContactsService },
    { provide: AGENT_INTERACTION_COMMANDS, useExisting: InteractionsService },
    { provide: AGENT_REMINDER_COMMANDS, useExisting: RemindersService },
    { provide: AGENT_FEEDBACK_COMMANDS, useExisting: BriefFeedbackService },
  ],
  exports: [AgentToolRegistryService],
})
export class AgentToolsModule {}
