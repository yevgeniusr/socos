import { GUARDS_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '../auth/auth.guard.js';
import { NotificationsController } from './notifications.controller.js';
import type { NotificationsService } from './notifications.service.js';

const request = { user: { userId: 'authenticated-user' } };
const identityHeader = ['x', 'user', 'id'].join('-');

describe('NotificationsController security', () => {
  const notificationsService = {
    findOwnedContact: jest.fn(),
    sendReminderNotification: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the canonical guarded notifications route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, NotificationsController)).toBe('notifications');
    expect(Reflect.getMetadata(GUARDS_METADATA, NotificationsController)).toContain(AuthGuard);
  });

  it('does not accept identity from route headers', () => {
    for (const methodName of Object.getOwnPropertyNames(NotificationsController.prototype)) {
      const routeArguments = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        NotificationsController,
        methodName,
      ) as Record<string, { data?: unknown }> | undefined;

      expect(
        Object.values(routeArguments ?? {}).some(
          ({ data }) => typeof data === 'string' && data.toLowerCase() === identityHeader,
        ),
      ).toBe(false);
    }
  });

  it('does not expose direct-send or cron controller methods', () => {
    expect(NotificationsController.prototype).not.toHaveProperty('sendEmail');
    expect(NotificationsController.prototype).not.toHaveProperty('sendEmailToContact');
    expect(NotificationsController.prototype).not.toHaveProperty('sendSms');
    expect(NotificationsController.prototype).not.toHaveProperty('sendSmsToContact');
    expect(NotificationsController.prototype).not.toHaveProperty('checkDueReminders');
  });

  it('owner-scopes reminder contacts and forwards the authenticated user', async () => {
    notificationsService.findOwnedContact.mockResolvedValue({
      firstName: 'Contact',
      lastName: 'Name',
    });
    notificationsService.sendReminderNotification.mockResolvedValue({ results: [] });
    const controller = new NotificationsController(
      notificationsService as unknown as NotificationsService,
    );

    await controller.sendReminderNotification(request as never, 'contact-1', {
      type: 'followup',
      message: 'Reconnect',
    });

    expect(notificationsService.findOwnedContact).toHaveBeenCalledWith(
      'authenticated-user',
      'contact-1',
    );
    expect(notificationsService.sendReminderNotification).toHaveBeenCalledWith(
      'authenticated-user',
      {
        contactName: 'Contact Name',
        type: 'followup',
        date: undefined,
        message: 'Reconnect',
      },
    );
  });
});
