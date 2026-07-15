import type { PrismaService } from '../../prisma/prisma.service.js';
import { ReminderAgent } from './reminder-agent.js';

describe('ReminderAgent ownership', () => {
  const prisma = {
    contactCelebration: {
      findMany: jest.fn(),
    },
    reminder: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('scopes celebration reminder synchronization to owned contacts', async () => {
    prisma.contactCelebration.findMany.mockResolvedValue([]);
    const agent = new ReminderAgent(prisma as unknown as PrismaService);

    await agent.syncCelebrationReminders({ userId: 'authenticated-user' });

    expect(prisma.contactCelebration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerId: 'authenticated-user',
          contact: { ownerId: 'authenticated-user', isDemo: false },
        }),
      }),
    );
  });

  it('checks and creates celebration reminders under the authenticated owner', async () => {
    const celebrationDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const month = String(celebrationDate.getMonth() + 1).padStart(2, '0');
    const day = String(celebrationDate.getDate()).padStart(2, '0');
    prisma.contactCelebration.findMany.mockResolvedValue([
      {
        contactId: 'contact-1',
        contact: { firstName: 'Synthetic', lastName: 'Contact', birthday: null },
        celebration: {
          name: 'Birthday',
          description: null,
          date: `${month}-${day}`,
          fullDate: null,
          calendarType: 'gregorian',
        },
      },
    ]);
    prisma.reminder.findFirst.mockResolvedValue(null);
    prisma.reminder.create.mockResolvedValue({ id: 'reminder-1' });
    const agent = new ReminderAgent(prisma as unknown as PrismaService);

    await agent.syncCelebrationReminders({ userId: 'authenticated-user' });

    expect(prisma.reminder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ ownerId: 'authenticated-user' }),
      }),
    );
    expect(prisma.reminder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ownerId: 'authenticated-user' }),
      }),
    );
  });
});
