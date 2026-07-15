/**
 * Notification Service
 *
 * Unified notification service that supports:
 * - Email via Resend
 * - SMS via Twilio
 *
 * Also handles:
 * - Template rendering
 * - User preferences (email/sms opt-out)
 * - Notification logging
 */

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { ResendEmailProvider } from './providers/resend.provider.js';
import { TwilioSmsProvider } from './providers/twilio.provider.js';
import {
  NotificationType,
  NotificationResult,
  NotificationTemplateData,
  NOTIFICATION_TEMPLATES,
} from './notifications/types.js';

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private emailProvider: ResendEmailProvider,
    private smsProvider: TwilioSmsProvider,
    private configService: ConfigService,
  ) {}

  async findOwnedContact(userId: string, contactId: string) {
    return this.prisma.contact.findFirst({
      where: { id: contactId, ownerId: userId },
      select: { firstName: true, lastName: true },
    });
  }

  /**
   * Send an email
   */
  async sendEmail(options: {
    to: string;
    subject: string;
    html?: string;
    text?: string;
  }): Promise<NotificationResult> {
    return this.emailProvider.send(options);
  }

  /**
   * Send an SMS
   */
  async sendSms(options: { to: string; body: string }): Promise<NotificationResult> {
    return this.smsProvider.send(options);
  }

  /**
   * Send a reminder notification via preferred channel (email or SMS)
   * Requires user preferences to determine channel
   */
  async sendReminderNotification(
    userId: string,
    reminder: {
      contactName: string;
      type: 'birthday' | 'anniversary' | 'followup' | 'stale';
      date?: string;
      message?: string;
    },
  ): Promise<{ results: NotificationResult[] }> {
    const results: NotificationResult[] = [];

    // Get user preferences
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        name: true,
      },
    });

    if (!user) {
      return { results: [{ success: false, error: 'User not found', provider: 'system', sentAt: new Date() }] };
    }

    const template = NOTIFICATION_TEMPLATES[reminder.type] || NOTIFICATION_TEMPLATES.followup;
    const templateData: NotificationTemplateData = {
      userName: user.name || 'there',
      contactName: reminder.contactName,
      reminderDate: reminder.date,
      message: reminder.message,
      ctaUrl: this.configService.get('APP_URL') || 'https://socos.app',
      ctaText: 'Open SOCOS',
    };

    // Render templates
    const subject = this.renderTemplate(template.subject, templateData);
    const emailHtml = this.renderTemplate(template.emailTemplate, templateData);
    const smsText = this.renderTemplate(template.smsTemplate, templateData);

    // Send via all configured channels
    if (user.email) {
      const emailResult = await this.emailProvider.send({
        to: user.email,
        subject,
        html: emailHtml,
      });
      results.push(emailResult);
    }

    // Get user's phone from contact fields if available
    const phoneResult = await this.getUserPhoneAndSend(userId, smsText);
    if (phoneResult) results.push(phoneResult);

    return { results };
  }

  /**
   * Send achievement notification
   */
  async sendAchievementNotification(
    userId: string,
    achievement: {
      name: string;
      description: string;
      xpReward: number;
    },
  ): Promise<{ results: NotificationResult[] }> {
    const results: NotificationResult[] = [];

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });

    if (!user) {
      return { results: [{ success: false, error: 'User not found', provider: 'system', sentAt: new Date() }] };
    }

    const template = NOTIFICATION_TEMPLATES.achievement;
    const templateData: NotificationTemplateData = {
      userName: user.name || 'there',
      achievementName: achievement.name,
      achievementDescription: achievement.description,
    };

    const subject = this.renderTemplate(template.subject, templateData);
    const html = this.renderTemplate(template.emailTemplate, templateData);

    if (user.email) {
      const emailResult = await this.emailProvider.send({
        to: user.email,
        subject,
        html,
      });
      results.push(emailResult);
    }

    return { results };
  }

  /**
   * Send level up notification
   */
  async sendLevelUpNotification(
    userId: string,
    level: number,
    levelName: string,
  ): Promise<{ results: NotificationResult[] }> {
    const results: NotificationResult[] = [];

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });

    if (!user) {
      return { results: [{ success: false, error: 'User not found', provider: 'system', sentAt: new Date() }] };
    }

    const template = NOTIFICATION_TEMPLATES.levelUp;
    const templateData: NotificationTemplateData = {
      userName: user.name || 'there',
      level: level.toString(),
      levelName,
    };

    const subject = this.renderTemplate(template.subject, templateData);
    const html = this.renderTemplate(template.emailTemplate, templateData);

    if (user.email) {
      const emailResult = await this.emailProvider.send({
        to: user.email,
        subject,
        html,
      });
      results.push(emailResult);
    }

    return { results };
  }

  /**
   * Send a celebration reminder notification (email + SMS)
   */
  async sendCelebrationNotification(
    userId: string,
    celebration: {
      contactName: string;
      celebrationName: string;
      reminderDate?: string;
    },
  ): Promise<{ results: NotificationResult[] }> {
    const results: NotificationResult[] = [];

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true },
    });

    if (!user) {
      return { results: [{ success: false, error: 'User not found', provider: 'system', sentAt: new Date() }] };
    }

    const template = NOTIFICATION_TEMPLATES.celebration;
    const templateData: NotificationTemplateData = {
      userName: user.name || 'there',
      contactName: celebration.contactName,
      reminderDate: celebration.reminderDate,
      ctaUrl: this.configService.get('APP_URL') || 'https://socos.app',
      ctaText: 'Open SOCOS',
    };

    const subject = this.renderTemplate(template.subject, templateData);
    const emailHtml = this.renderTemplate(template.emailTemplate, templateData);
    const smsText = this.renderTemplate(template.smsTemplate, templateData);

    if (user.email) {
      const emailResult = await this.emailProvider.send({
        to: user.email,
        subject,
        html: emailHtml,
      });
      results.push(emailResult);
    }

    const phoneResult = await this.getUserPhoneAndSend(userId, smsText);
    if (phoneResult) results.push(phoneResult);

    return { results };
  }

  /**
   * Send gamification achievement notification (alias for sendAchievementNotification)
   */
  async sendGamificationAchievement(
    userId: string,
    achievement: { name: string; description: string; xpReward: number },
  ): Promise<{ results: NotificationResult[] }> {
    return this.sendAchievementNotification(userId, achievement);
  }

  /**
   * Send level-up notification (alias for sendLevelUpNotification)
   */
  async sendGamificationLevelUp(
    userId: string,
    level: number,
    levelName: string,
  ): Promise<{ results: NotificationResult[] }> {
    return this.sendLevelUpNotification(userId, level, levelName);
  }

  /**
   * Send a custom message to a contact via email
   */
  async sendEmailToContact(
    userId: string,
    contactId: string,
    options: { subject: string; html?: string; text?: string },
  ): Promise<NotificationResult> {
    // Get contact's primary email
    const contactField = await this.prisma.contactField.findFirst({
      where: {
        contactId,
        type: 'email',
        isPrimary: true,
      },
    });

    if (!contactField) {
      return {
        success: false,
        error: 'Contact has no primary email',
        provider: 'resend',
        sentAt: new Date(),
      };
    }

    // Get user info for "from" name
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });

    if (!user) {
      return {
        success: false,
        error: 'User not found',
        provider: 'resend',
        sentAt: new Date(),
      };
    }

    return this.emailProvider.send({
      to: contactField.value,
      subject: options.subject,
      html: options.html,
      text: options.text,
      from: `${user.name || 'SOCOS'} <${user.email}>`,
    });
  }

  /**
   * Send a custom SMS to a contact
   */
  async sendSmsToContact(
    userId: string,
    contactId: string,
    body: string,
  ): Promise<NotificationResult> {
    // Get contact's primary phone
    const contactField = await this.prisma.contactField.findFirst({
      where: {
        contactId,
        type: 'phone',
        isPrimary: true,
      },
    });

    if (!contactField) {
      return {
        success: false,
        error: 'Contact has no primary phone number',
        provider: 'twilio',
        sentAt: new Date(),
      };
    }

    return this.smsProvider.send({
      to: contactField.value,
      body,
    });
  }

  // ========== Private Helpers ==========

  private async getUserPhoneAndSend(
    userId: string,
    message: string,
  ): Promise<NotificationResult | null> {
    // In production, you'd look up user's phone from their profile
    // For now, we check if user has a phone field set up
    // This would need to be implemented based on user settings
    return null;
  }

  /**
   * Simple template renderer
   * Supports: {{variable}} substitution
   */
  private renderTemplate(template: string, data: NotificationTemplateData): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const value = (data as any)[key];
      return value !== undefined ? value : match;
    });
  }

  /**
   * Check if Resend is configured
   */
  isEmailConfigured(): boolean {
    const apiKey = this.configService.get<string>('RESEND_API_KEY');
    return !!apiKey;
  }

  /**
   * Check if Twilio is configured
   */
  isSmsConfigured(): boolean {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    return !!(accountSid && authToken);
  }
}
