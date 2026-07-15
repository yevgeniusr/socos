import { NotFoundException } from '@nestjs/common';
import type { GamificationService } from '../gamification/gamification.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ContactsService } from './contacts.service.js';

describe('ContactsService preferences', () => {
  it('persists create-time importance and cadence overrides', async () => {
    const prisma = {
      vault: {
        findFirst: jest.fn().mockResolvedValue({ id: 'synthetic-vault' }),
      },
      contact: {
        create: jest.fn().mockResolvedValue({
          id: 'synthetic-contact',
          socialLinks: null,
        }),
      },
    };
    const service = new ContactsService(
      prisma as unknown as PrismaService,
      {} as GamificationService,
    );

    await service.create('synthetic-owner', {
      firstName: 'Synthetic',
      importance: 5,
      preferredCadenceDays: 30,
    });

    expect(prisma.contact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'synthetic-owner',
          importance: 5,
          preferredCadenceDays: 30,
        }),
      }),
    );
  });

  it('rejects a selected vault that is not owned by the caller', async () => {
    const prisma = {
      vault: {
        findFirst: jest.fn().mockImplementation(({ where }) =>
          Promise.resolve(where.id ? null : { id: 'owned-default-vault' }),
        ),
      },
      contact: {
        create: jest.fn(),
      },
    };
    const service = new ContactsService(
      prisma as unknown as PrismaService,
      {} as GamificationService,
    );

    await expect(
      service.create('synthetic-owner', {
        firstName: 'Synthetic',
        vaultId: 'foreign-vault',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.vault.findFirst).toHaveBeenCalledWith({
      where: { id: 'foreign-vault', ownerId: 'synthetic-owner' },
    });
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });

  it('persists preference updates through the owner-scoped update path', async () => {
    const prisma = {
      contact: {
        findFirst: jest.fn().mockResolvedValue({ id: 'synthetic-contact' }),
        update: jest.fn().mockResolvedValue({
          id: 'synthetic-contact',
          socialLinks: null,
        }),
      },
    };
    const service = new ContactsService(
      prisma as unknown as PrismaService,
      {} as GamificationService,
    );

    await service.update('synthetic-owner', 'synthetic-contact', {
      importance: 4,
      preferredCadenceDays: 45,
    });

    expect(prisma.contact.findFirst).toHaveBeenCalledWith({
      where: { id: 'synthetic-contact', ownerId: 'synthetic-owner' },
    });
    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: 'synthetic-contact' },
      data: { importance: 4, preferredCadenceDays: 45 },
    });
  });
});
