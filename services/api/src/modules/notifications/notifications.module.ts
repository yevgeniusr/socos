/**
 * Notifications Module
 */

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { ResendEmailProvider } from './providers/resend.provider.js';
import { TwilioSmsProvider } from './providers/twilio.provider.js';
import { JwtService } from '../jwt/jwt.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

@Module({
  imports: [ConfigModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    ResendEmailProvider,
    TwilioSmsProvider,
    JwtService,
    PrismaService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
