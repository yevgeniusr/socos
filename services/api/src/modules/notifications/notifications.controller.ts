import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard.js';
import { NotificationsService } from './notifications.service.js';

type AuthenticatedRequest = { user: { userId: string } };

@ApiTags('Notifications')
@Controller('notifications')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('reminders/:contactId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send reminder notification for a contact' })
  async sendReminderNotification(
    @Request() req: AuthenticatedRequest,
    @Param('contactId') contactId: string,
    @Body()
    body: {
      type: 'birthday' | 'anniversary' | 'followup' | 'stale';
      date?: string;
      message?: string;
    },
  ) {
    const userId = req.user.userId;
    const contact = await this.notificationsService.findOwnedContact(userId, contactId);

    if (!contact) {
      return {
        results: [
          {
            success: false,
            error: 'Contact not found',
            provider: 'system',
            sentAt: new Date(),
          },
        ],
      };
    }

    return this.notificationsService.sendReminderNotification(userId, {
      contactName: `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`,
      type: body.type,
      date: body.date,
      message: body.message,
    });
  }

  @Get('status')
  @ApiOperation({ summary: 'Check notification provider status' })
  async getStatus() {
    return {
      email: this.notificationsService.isEmailConfigured()
        ? { configured: true, provider: 'resend' }
        : {
            configured: false,
            provider: 'resend',
            message: 'Set RESEND_API_KEY to enable',
          },
      sms: this.notificationsService.isSmsConfigured()
        ? { configured: true, provider: 'twilio' }
        : {
            configured: false,
            provider: 'twilio',
            message: 'Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to enable',
          },
    };
  }
}
