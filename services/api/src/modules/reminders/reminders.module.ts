/**
 * Reminders Module
 */

import { Module } from '@nestjs/common';
import { RemindersController } from './reminders.controller.js';
import { RemindersService } from './reminders.service.js';
import { AgentRemindersService } from './agent-reminders.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { JwtService } from '../jwt/jwt.service.js';

@Module({
  imports: [NotificationsModule],
  controllers: [RemindersController],
  providers: [RemindersService, AgentRemindersService, PrismaService, JwtService],
  exports: [RemindersService, AgentRemindersService],
})
export class RemindersModule {}
