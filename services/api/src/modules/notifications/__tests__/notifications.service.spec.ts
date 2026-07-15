import { NotificationsService } from '../notifications.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ResendEmailProvider } from '../providers/resend.provider.js';
import { TwilioSmsProvider } from '../providers/twilio.provider.js';
import { ConfigService } from '@nestjs/config';

// Mock providers
const mockResend = {
  send: jest.fn(),
  sendBatch: jest.fn(),
  suppressEmail: jest.fn(),
} as unknown as jest.Mocked<ResendEmailProvider>;

const mockTwilio = {
  send: jest.fn(),
  getMessageStatus: jest.fn(),
  listPhoneNumbers: jest.fn(),
  validateNumber: jest.fn(),
} as unknown as jest.Mocked<TwilioSmsProvider>;

const mockConfigService = {
  get: jest.fn((key: string) => {
    if (key === 'RESEND_API_KEY') return 're_test_key';
    if (key === 'TWILIO_ACCOUNT_SID') return 'AC_test';
    if (key === 'TWILIO_AUTH_TOKEN') return 'auth_test';
    if (key === 'APP_URL') return 'https://socos.app';
    return undefined;
  }),
} as unknown as jest.Mocked<ConfigService>;

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  contact: {
    findFirst: jest.fn(),
  },
  contactField: {
    findFirst: jest.fn(),
  },
} as unknown as jest.Mocked<PrismaService>;

describe('NotificationsService', () => {
  let service: NotificationsService;

  beforeEach(() => {
    service = new NotificationsService(mockPrisma, mockResend, mockTwilio, mockConfigService);
    jest.clearAllMocks();
  });

  describe('findOwnedContact', () => {
    it('looks up a contact by both id and authenticated owner', async () => {
      mockPrisma.contact.findFirst = jest.fn().mockResolvedValue({
        firstName: 'Contact',
        lastName: 'Name',
      });

      await service.findOwnedContact('user-1', 'contact-1');

      expect(mockPrisma.contact.findFirst).toHaveBeenCalledWith({
        where: { id: 'contact-1', ownerId: 'user-1' },
        select: { firstName: true, lastName: true },
      });
    });
  });

  describe('sendEmail', () => {
    it('should delegate to ResendEmailProvider', async () => {
      mockResend.send = jest.fn().mockResolvedValue({ success: true, provider: 'resend', sentAt: new Date() });
      const result = await service.sendEmail({ to: 'test@example.com', subject: 'Hello', html: '<p>Test</p>' });
      expect(mockResend.send).toHaveBeenCalledWith({ to: 'test@example.com', subject: 'Hello', html: '<p>Test</p>' });
      expect(result.success).toBe(true);
    });
  });

  describe('sendSms', () => {
    it('should delegate to TwilioSmsProvider', async () => {
      mockTwilio.send = jest.fn().mockResolvedValue({ success: true, provider: 'twilio', sentAt: new Date() });
      const result = await service.sendSms({ to: '+1234567890', body: 'Hello' });
      expect(mockTwilio.send).toHaveBeenCalledWith({ to: '+1234567890', body: 'Hello' });
      expect(result.success).toBe(true);
    });
  });

  describe('sendReminderNotification', () => {
    it('should send email for birthday reminder', async () => {
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue({ email: 'user@test.com', name: 'Alice' });
      mockResend.send = jest.fn().mockResolvedValue({ success: true, provider: 'resend', sentAt: new Date() });

      const result = await service.sendReminderNotification('user-1', {
        contactName: 'Bob',
        type: 'birthday',
        date: '2024-01-01',
      });

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { email: true, name: true },
      });
      expect(mockResend.send).toHaveBeenCalled();
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results[0].success).toBe(true);
    });

    it('should handle missing user gracefully', async () => {
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue(null);
      const result = await service.sendReminderNotification('unknown', {
        contactName: 'Bob',
        type: 'followup',
      });
      expect(result.results[0].success).toBe(false);
      expect(result.results[0].error).toContain('User not found');
    });

    it('should render template variables correctly', async () => {
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue({ email: 'user@test.com', name: 'Alice' });
      mockResend.send = jest.fn().mockResolvedValue({ success: true, provider: 'resend', sentAt: new Date() });

      await service.sendReminderNotification('user-1', {
        contactName: 'Bob',
        type: 'birthday',
        date: '2024-06-15',
      });

      const callArg = mockResend.send.mock.calls[0][0];
      expect(callArg.subject).toContain("Bob's birthday is coming up!");
      expect(callArg.html).toContain('Alice');
      expect(callArg.html).toContain('Bob');
      expect(callArg.html).toContain('2024-06-15');
    });
  });

  describe('sendAchievementNotification', () => {
    it('should send achievement email', async () => {
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue({ email: 'user@test.com', name: 'Alice' });
      mockResend.send = jest.fn().mockResolvedValue({ success: true, provider: 'resend', sentAt: new Date() });

      const result = await service.sendAchievementNotification('user-1', {
        name: 'Social Butterfly',
        description: 'Added 10 contacts',
        xpReward: 500,
      });

      expect(mockResend.send).toHaveBeenCalled();
      expect(result.results[0].success).toBe(true);
    });
  });

  describe('sendLevelUpNotification', () => {
    it('should send level-up email', async () => {
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue({ email: 'user@test.com', name: 'Alice' });
      mockResend.send = jest.fn().mockResolvedValue({ success: true, provider: 'resend', sentAt: new Date() });

      const result = await service.sendLevelUpNotification('user-1', 5, 'Connector');

      expect(mockResend.send).toHaveBeenCalled();
      const callArg = mockResend.send.mock.calls[0][0];
      expect(callArg.subject).toContain('Level 5');
      expect(callArg.html).toContain('Connector');
      expect(result.results[0].success).toBe(true);
    });
  });

  describe('sendCelebrationNotification', () => {
    it('should send celebration email with correct template', async () => {
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue({ email: 'user@test.com', name: 'Alice' });
      mockResend.send = jest.fn().mockResolvedValue({ success: true, provider: 'resend', sentAt: new Date() });

      const result = await service.sendCelebrationNotification('user-1', {
        contactName: 'Charlie',
        celebrationName: "Chinese New Year",
        reminderDate: '2025-01-29',
      });

      expect(mockResend.send).toHaveBeenCalled();
      const callArg = mockResend.send.mock.calls[0][0];
      expect(callArg.subject).toContain("Charlie's celebration is coming up!");
      expect(callArg.html).toContain('Charlie');
      expect(callArg.html).toContain('2025-01-29');
      expect(result.results[0].success).toBe(true);
    });
  });

  describe('sendEmailToContact', () => {
    it('should send email to contact using primary email', async () => {
      mockPrisma.contactField.findFirst = jest.fn().mockResolvedValue({ value: 'contact@example.com' });
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue({ name: 'Alice', email: 'alice@test.com' });
      mockResend.send = jest.fn().mockResolvedValue({ success: true, provider: 'resend', sentAt: new Date() });

      const result = await service.sendEmailToContact('user-1', 'contact-1', {
        subject: 'Hello',
        html: '<p>Hi</p>',
      });

      expect(mockResend.send).toHaveBeenCalledWith(expect.objectContaining({
        to: 'contact@example.com',
        from: 'Alice <alice@test.com>',
      }));
      expect(result.success).toBe(true);
    });

    it('should return error when contact has no primary email', async () => {
      mockPrisma.contactField.findFirst = jest.fn().mockResolvedValue(null);

      const result = await service.sendEmailToContact('user-1', 'contact-1', {
        subject: 'Hello',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('no primary email');
    });
  });

  describe('sendSmsToContact', () => {
    it('should send SMS to contact using primary phone', async () => {
      mockPrisma.contactField.findFirst = jest.fn().mockResolvedValue({ value: '+1234567890' });
      mockTwilio.send = jest.fn().mockResolvedValue({ success: true, provider: 'twilio', sentAt: new Date() });

      const result = await service.sendSmsToContact('user-1', 'contact-1', 'Hello!');

      expect(mockTwilio.send).toHaveBeenCalledWith({ to: '+1234567890', body: 'Hello!' });
      expect(result.success).toBe(true);
    });

    it('should return error when contact has no primary phone', async () => {
      mockPrisma.contactField.findFirst = jest.fn().mockResolvedValue(null);

      const result = await service.sendSmsToContact('user-1', 'contact-1', 'Hello!');

      expect(result.success).toBe(false);
      expect(result.error).toContain('no primary phone number');
    });
  });

  describe('isEmailConfigured / isSmsConfigured', () => {
    it('should return true when Resend API key is set', () => {
      expect(service.isEmailConfigured()).toBe(true);
    });

    it('should return true when Twilio credentials are set', () => {
      expect(service.isSmsConfigured()).toBe(true);
    });

    it('should return false when Resend API key is missing', () => {
      const emptyConfig = { get: jest.fn(() => undefined) } as unknown as ConfigService;
      const emptyService = new NotificationsService(mockPrisma, mockResend, mockTwilio, emptyConfig);
      expect(emptyService.isEmailConfigured()).toBe(false);
      expect(emptyService.isSmsConfigured()).toBe(false);
    });
  });

  describe('sendGamificationAchievement / sendGamificationLevelUp', () => {
    it('should send gamification achievement via alias', async () => {
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue({ email: 'user@test.com', name: 'Alice' });
      mockResend.send = jest.fn().mockResolvedValue({ success: true, provider: 'resend', sentAt: new Date() });

      const result = await service.sendGamificationAchievement('user-1', {
        name: 'Streak Master',
        description: '7-day streak',
        xpReward: 175,
      });

      expect(mockResend.send).toHaveBeenCalled();
      expect(result.results[0].success).toBe(true);
    });

    it('should send gamification level-up via alias', async () => {
      mockPrisma.user.findUnique = jest.fn().mockResolvedValue({ email: 'user@test.com', name: 'Alice' });
      mockResend.send = jest.fn().mockResolvedValue({ success: true, provider: 'resend', sentAt: new Date() });

      const result = await service.sendGamificationLevelUp('user-1', 10, 'Connector');

      expect(mockResend.send).toHaveBeenCalled();
      expect(result.results[0].success).toBe(true);
    });
  });
});
