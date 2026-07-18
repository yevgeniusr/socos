import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { ContactsService } from './contacts.service.js';

function makeService(prisma: Record<string, any>) {
  return new ContactsService(prisma as unknown as PrismaService);
}

function withTransaction(contact: Record<string, jest.Mock>) {
  const prisma: Record<string, any> = { contact };
  prisma.$transaction = jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma));
  return prisma;
}

function applyPrismaProjection(record: Record<string, any>, args: Record<string, any>) {
  if (!args.select) return record;

  return Object.fromEntries(
    Object.keys(args.select)
      .filter((key) => key in record)
      .map((key) => [key, record[key]]),
  );
}

function expectedDetailRelations(ownerId: string) {
  return {
    contactFields: {
      select: {
        id: true,
        type: true,
        value: true,
        label: true,
        isPrimary: true,
      },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    },
    interactions: {
      where: { ownerId },
      select: {
        id: true,
        type: true,
        title: true,
        content: true,
        occurredAt: true,
      },
      orderBy: { occurredAt: 'desc' },
      take: 10,
    },
    reminders: {
      where: { ownerId, status: 'pending' },
      select: {
        id: true,
        title: true,
        description: true,
        scheduledAt: true,
      },
      orderBy: { scheduledAt: 'asc' },
      take: 5,
    },
    _count: {
      select: {
        interactions: { where: { ownerId } },
        reminders: { where: { ownerId } },
        tasks: true,
        gifts: true,
      },
    },
  };
}

function expectSafeDetailRelations(select: Record<string, any>, ownerId: string) {
  const expected = expectedDetailRelations(ownerId);
  expect(select.contactFields).toEqual(expected.contactFields);
  expect(select.interactions).toEqual(expected.interactions);
  expect(select.reminders).toEqual(expected.reminders);
  expect(select._count).toEqual(expected._count);
}

describe('ContactsService personal profiles', () => {
  describe('list and facets', () => {
    it('uses bounded pagination, non-demo isolation, group filtering, and stable allowlisted sorting', async () => {
      const prisma = {
        contact: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
      };
      const service = makeService(prisma);

      await expect(
        service.findAll('synthetic-owner', {
          group: 'Mentors',
          limit: 25,
          offset: 25,
          sortBy: 'firstName',
          sortOrder: 'asc',
        } as any),
      ).resolves.toEqual({ contacts: [], total: 0, offset: 25, limit: 25 });

      const expectedWhere = {
        ownerId: 'synthetic-owner',
        isDemo: false,
        groups: { has: 'Mentors' },
      };
      expect(prisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expectedWhere,
          skip: 25,
          take: 25,
          orderBy: [{ firstName: 'asc' }, { id: 'asc' }],
        }),
      );
      expect(prisma.contact.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });

      const listArgs = prisma.contact.findMany.mock.calls[0][0];
      expect(listArgs.include).toBeUndefined();
      expect(Object.keys(listArgs.select).sort()).toEqual(
        [
          '_count',
          'company',
          'createdAt',
          'firstName',
          'groups',
          'id',
          'importance',
          'jobTitle',
          'labels',
          'lastContactedAt',
          'lastName',
          'nextReminderAt',
          'nickname',
          'photo',
          'preferredCadenceDays',
          'relationshipScore',
          'tags',
          'updatedAt',
        ].sort(),
      );
      expect(listArgs.select.sourceId).toBeUndefined();
      expect(listArgs.select.bio).toBeUndefined();
      expect(listArgs.select.contactFields).toBeUndefined();
    });

    it('defaults to a 25-row first page and deterministic created-at ordering', async () => {
      const prisma = {
        contact: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        },
      };

      const result = await makeService(prisma).findAll('synthetic-owner', {});

      expect(result).toEqual({ contacts: [], total: 0, offset: 0, limit: 25 });
      expect(prisma.contact.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { ownerId: 'synthetic-owner', isDemo: false },
          skip: 0,
          take: 25,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        }),
      );
    });

    it.each([
      ['getLabels', 'labels'],
      ['getTags', 'tags'],
      ['getGroups', 'groups'],
    ] as const)('returns owner-scoped non-demo %s facets', async (method, field) => {
      const prisma = {
        contact: {
          findMany: jest
            .fn()
            .mockResolvedValue([{ [field]: ['Zulu', 'Alpha'] }, { [field]: ['Alpha'] }]),
        },
      };

      await expect(makeService(prisma)[method]('synthetic-owner')).resolves.toEqual([
        'Alpha',
        'Zulu',
      ]);
      expect(prisma.contact.findMany).toHaveBeenCalledWith({
        where: { ownerId: 'synthetic-owner', isDemo: false },
        select: { [field]: true },
      });
    });
  });

  describe('detail reads', () => {
    const contactDetail = {
      id: 'synthetic-contact',
      firstName: 'Synthetic',
      socialLinks: { website: 'https://example.test' },
      contactFields: [
        {
          id: 'synthetic-field',
          type: 'email',
          value: 'person@example.test',
          label: null,
          isPrimary: true,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      interactions: [],
      reminders: [],
      _count: { interactions: 0, reminders: 0, tasks: 0, gifts: 0 },
    };

    it('uses an explicit owner-scoped non-demo projection with ordered fields', async () => {
      const prisma = {
        contact: { findFirst: jest.fn().mockResolvedValue(contactDetail) },
      };

      const detail: any = await makeService(prisma).findOne('synthetic-owner', 'synthetic-contact');

      expect(detail.contactFields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'email',
            value: 'person@example.test',
          }),
        ]),
      );
      expect(detail.socialLinks).toEqual({ website: 'https://example.test' });
      expect(prisma.contact.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'synthetic-contact',
            ownerId: 'synthetic-owner',
            isDemo: false,
          },
        }),
      );

      const args = prisma.contact.findFirst.mock.calls[0][0];
      expect(args.include).toBeUndefined();
      expectSafeDetailRelations(args.select, 'synthetic-owner');
      expect(args.select.sourceSystem).toBe(true);
      expect(args.select.importedAt).toBe(true);
      expect(args.select.sourceId).toBeUndefined();
      expect(args.select.ownerId).toBeUndefined();
    });

    it('reads legacy JSON-string social links during transition', async () => {
      const prisma = {
        contact: {
          findFirst: jest.fn().mockResolvedValue({
            ...contactDetail,
            socialLinks: '{"github":"https://github.com/synthetic"}',
          }),
        },
      };

      await expect(
        makeService(prisma).findOne('synthetic-owner', 'synthetic-contact'),
      ).resolves.toMatchObject({
        socialLinks: { github: 'https://github.com/synthetic' },
      });
    });

    it('does not return demo or foreign contacts', async () => {
      const prisma = {
        contact: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      await expect(
        makeService(prisma).findOne('synthetic-owner', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('writes', () => {
    const mutationDetail = {
      id: 'synthetic-contact',
      firstName: 'Synthetic',
      sourceId: 'provider-contact-id',
      owner: { id: 'synthetic-owner', email: 'owner@example.test' },
      socialLinks: '{"github":"https://github.com/synthetic"}',
      contactFields: [{ id: 'synthetic-field', type: 'email', value: 'person@example.test' }],
      interactions: [{ id: 'synthetic-interaction' }],
      reminders: [{ id: 'synthetic-reminder' }],
      _count: { interactions: 1, reminders: 1, tasks: 0, gifts: 0 },
    };

    it('returns a safely projected detail profile after create', async () => {
      const prisma = {
        vault: {
          findFirst: jest.fn().mockResolvedValue({ id: 'synthetic-vault' }),
        },
        contact: {
          create: jest
            .fn()
            .mockImplementation((args) => Promise.resolve(applyPrismaProjection(mutationDetail, args))),
        },
      };

      const result = await makeService(prisma).create('synthetic-owner', {
        firstName: 'Synthetic',
      });

      const args = prisma.contact.create.mock.calls[0][0];
      expect(args.include).toBeUndefined();
      expectSafeDetailRelations(args.select, 'synthetic-owner');
      expect(args.select.sourceId).toBeUndefined();
      expect(args.select.owner).toBeUndefined();
      expect(result).toMatchObject({
        contactFields: mutationDetail.contactFields,
        interactions: mutationDetail.interactions,
        reminders: mutationDetail.reminders,
        _count: mutationDetail._count,
        socialLinks: { github: 'https://github.com/synthetic' },
      });
      expect(result).not.toHaveProperty('sourceId');
      expect(result).not.toHaveProperty('owner');
    });

    it('returns a safely projected detail profile after update', async () => {
      const contact = {
        findFirst: jest.fn().mockResolvedValue({ id: 'synthetic-contact' }),
        update: jest
          .fn()
          .mockImplementation((args) => Promise.resolve(applyPrismaProjection(mutationDetail, args))),
      };
      const prisma = withTransaction(contact);

      const result = await makeService(prisma).update('synthetic-owner', 'synthetic-contact', {
        firstName: 'Updated',
      });

      const args = contact.update.mock.calls[0][0];
      expect(args.include).toBeUndefined();
      expectSafeDetailRelations(args.select, 'synthetic-owner');
      expect(args.select.sourceId).toBeUndefined();
      expect(args.select.owner).toBeUndefined();
      expect(result).toMatchObject({
        contactFields: mutationDetail.contactFields,
        interactions: mutationDetail.interactions,
        reminders: mutationDetail.reminders,
        _count: mutationDetail._count,
        socialLinks: { github: 'https://github.com/synthetic' },
      });
      expect(result).not.toHaveProperty('sourceId');
      expect(result).not.toHaveProperty('owner');
    });

    it('creates normalized contact fields and stores social links as JSON', async () => {
      const prisma = {
        vault: {
          findFirst: jest.fn().mockResolvedValue({ id: 'synthetic-vault' }),
        },
        contact: {
          create: jest.fn().mockResolvedValue({
            id: 'synthetic-contact',
            socialLinks: { website: 'https://example.test' },
          }),
        },
      };

      await makeService(prisma).create('synthetic-owner', {
        firstName: 'Synthetic',
        importance: 5,
        preferredCadenceDays: 30,
        socialLinks: { website: 'https://example.test' },
        contactFields: [{ type: ' email ', value: ' person@example.test ', label: ' work ' }],
      } as any);

      expect(prisma.contact.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ownerId: 'synthetic-owner',
            importance: 5,
            preferredCadenceDays: 30,
            socialLinks: { website: 'https://example.test' },
            contactFields: {
              create: [
                {
                  type: 'email',
                  value: 'person@example.test',
                  label: 'work',
                  isPrimary: false,
                },
              ],
            },
          }),
        }),
      );
    });

    it('rejects a selected vault that is not owned by the caller', async () => {
      const prisma = {
        vault: { findFirst: jest.fn().mockResolvedValue(null) },
        contact: { create: jest.fn() },
      };

      await expect(
        makeService(prisma).create('synthetic-owner', {
          firstName: 'Synthetic',
          vaultId: 'foreign-vault',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.contact.create).not.toHaveBeenCalled();
    });

    it('preserves contact fields when omitted', async () => {
      const contact = {
        findFirst: jest.fn().mockResolvedValue({ id: 'synthetic-contact' }),
        update: jest.fn().mockResolvedValue({ id: 'synthetic-contact', socialLinks: null }),
      };
      const prisma = withTransaction(contact);

      await makeService(prisma).update('synthetic-owner', 'synthetic-contact', {
        importance: 4,
        preferredCadenceDays: 45,
      });

      expect(contact.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'synthetic-contact',
          ownerId: 'synthetic-owner',
          isDemo: false,
        },
        select: { id: true },
      });
      expect(contact.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'synthetic-contact' },
          data: { importance: 4, preferredCadenceDays: 45 },
        }),
      );
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: 'Serializable',
      });
    });

    it('clears fields with an empty replacement set', async () => {
      const contact = {
        findFirst: jest.fn().mockResolvedValue({ id: 'synthetic-contact' }),
        update: jest.fn().mockResolvedValue({ id: 'synthetic-contact', socialLinks: null }),
      };
      const prisma = withTransaction(contact);

      await makeService(prisma).update('synthetic-owner', 'synthetic-contact', {
        contactFields: [],
      } as any);

      expect(contact.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'synthetic-contact' },
          data: { contactFields: { deleteMany: {}, create: [] } },
        }),
      );
    });

    it('normalizes and serializably replaces provided fields', async () => {
      const contact = {
        findFirst: jest.fn().mockResolvedValue({ id: 'synthetic-contact' }),
        update: jest.fn().mockResolvedValue({ id: 'synthetic-contact', socialLinks: null }),
      };
      const prisma = withTransaction(contact);

      await makeService(prisma).update('synthetic-owner', 'synthetic-contact', {
        contactFields: [
          {
            type: ' email ',
            value: ' person@example.test ',
            label: ' work ',
            isPrimary: true,
          },
        ],
      } as any);

      expect(contact.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contactFields: {
              deleteMany: {},
              create: [
                {
                  type: 'email',
                  value: 'person@example.test',
                  label: 'work',
                  isPrimary: true,
                },
              ],
            },
          }),
        }),
      );
    });

    it('rejects duplicate primary fields of the same type', async () => {
      const contact = {
        findFirst: jest.fn().mockResolvedValue({ id: 'synthetic-contact' }),
        update: jest.fn(),
      };
      const prisma = withTransaction(contact);

      await expect(
        makeService(prisma).update('synthetic-owner', 'synthetic-contact', {
          contactFields: [
            { type: 'email', value: 'one@example.test', isPrimary: true },
            { type: ' email ', value: 'two@example.test', isPrimary: true },
          ],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(contact.update).not.toHaveBeenCalled();
    });

    it('rejects blank normalized field values defensively', async () => {
      const contact = {
        findFirst: jest.fn().mockResolvedValue({ id: 'synthetic-contact' }),
        update: jest.fn(),
      };
      const prisma = withTransaction(contact);

      await expect(
        makeService(prisma).update('synthetic-owner', 'synthetic-contact', {
          contactFields: [{ type: 'email', value: '   ' }],
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(contact.update).not.toHaveBeenCalled();
    });

    it('converts and clears dates while persisting groups and first-met context', async () => {
      const contact = {
        findFirst: jest.fn().mockResolvedValue({ id: 'synthetic-contact' }),
        update: jest.fn().mockResolvedValue({ id: 'synthetic-contact', socialLinks: null }),
      };
      const prisma = withTransaction(contact);

      await makeService(prisma).update('synthetic-owner', 'synthetic-contact', {
        birthday: null,
        anniversary: '2020-06-10T00:00:00.000Z',
        firstMetDate: null,
        firstMetContext: 'Synthetic conference',
        groups: ['Mentors'],
      } as any);

      expect(contact.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'synthetic-contact' },
          data: {
            birthday: null,
            birthdayMonth: null,
            birthdayDay: null,
            anniversary: new Date('2020-06-10T00:00:00.000Z'),
            firstMetDate: null,
            firstMetContext: 'Synthetic conference',
            groups: ['Mentors'],
          },
        }),
      );
    });

    it('clears first-met context with null', async () => {
      const contact = {
        findFirst: jest.fn().mockResolvedValue({ id: 'synthetic-contact' }),
        update: jest.fn().mockResolvedValue({ id: 'synthetic-contact', socialLinks: null }),
      };
      const prisma = withTransaction(contact);

      await makeService(prisma).update('synthetic-owner', 'synthetic-contact', {
        firstMetContext: null,
      });

      expect(contact.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'synthetic-contact' },
          data: { firstMetContext: null },
        }),
      );
    });
  });
});
