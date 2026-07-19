import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  CONTACT_FIELD_TYPES,
  ContactFieldDto,
  ContactQueryDto,
  ContactSortBy,
  CreateContactDto,
  SortOrder,
  UpdateContactDto,
} from './contacts.dto.js';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export interface AgentContactCreateInput {
  firstName: string;
  lastName?: string;
  nickname?: string;
  labels?: string[];
  tags?: string[];
  groups?: string[];
}

const CONTACT_LIST_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  nickname: true,
  photo: true,
  company: true,
  jobTitle: true,
  relationshipScore: true,
  importance: true,
  preferredCadenceDays: true,
  labels: true,
  tags: true,
  groups: true,
  lastContactedAt: true,
  nextReminderAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { interactions: true, reminders: true } },
} satisfies Prisma.ContactSelect;

function contactDetailSelect(ownerId: string) {
  return {
    id: true,
    firstName: true,
    lastName: true,
    middleName: true,
    nickname: true,
    photo: true,
    bio: true,
    company: true,
    jobTitle: true,
    birthday: true,
    birthdayMonth: true,
    birthdayDay: true,
    anniversary: true,
    relationshipScore: true,
    importance: true,
    preferredCadenceDays: true,
    labels: true,
    tags: true,
    groups: true,
    socialLinks: true,
    firstMetDate: true,
    firstMetContext: true,
    lastContactedAt: true,
    nextReminderAt: true,
    sourceSystem: true,
    importedAt: true,
    createdAt: true,
    updatedAt: true,
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
  } satisfies Prisma.ContactSelect;
}

const SOCIAL_LINK_KEYS = new Set([
  'linkedin',
  'twitter',
  'instagram',
  'facebook',
  'github',
  'website',
]);

function parseSocialLinks(value: Prisma.JsonValue | null | undefined) {
  if (value == null) return null;

  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const links: Record<string, string> = {};
  for (const [key, link] of Object.entries(parsed)) {
    if (!SOCIAL_LINK_KEYS.has(key) || typeof link !== 'string') continue;
    try {
      const url = new URL(link);
      if (url.protocol === 'http:' || url.protocol === 'https:') links[key] = link;
    } catch {
      // Ignore unsafe legacy values instead of returning renderable links.
    }
  }
  return links;
}

function normalizeContactFields(fields: ContactFieldDto[]) {
  if (fields.length > 20) {
    throw new BadRequestException('A contact may have at most 20 contact fields');
  }

  const primaryTypes = new Set<string>();
  return fields.map((field) => {
    const type = field.type.trim();
    const value = field.value.trim();
    const label = field.label?.trim();

    if (!CONTACT_FIELD_TYPES.includes(type as (typeof CONTACT_FIELD_TYPES)[number])) {
      throw new BadRequestException(`Unsupported contact field type: ${type}`);
    }
    if (!value) throw new BadRequestException('Contact field values cannot be blank');
    if (field.isPrimary && primaryTypes.has(type)) {
      throw new BadRequestException(`Only one primary ${type} field is allowed`);
    }
    if (field.isPrimary) primaryTypes.add(type);

    return {
      type,
      value,
      label: label || undefined,
      isPrimary: field.isPrimary ?? false,
    };
  });
}

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateContactDto) {
    // Get user's default vault
    const vault = await this.prisma.vault.findFirst({
      where: dto.vaultId ? { id: dto.vaultId, ownerId: userId } : { ownerId: userId },
    });

    if (!vault) {
      throw new NotFoundException('No vault found. Please create a vault first.');
    }

    const contactFields = dto.contactFields ? normalizeContactFields(dto.contactFields) : undefined;
    const contact = await this.prisma.contact.create({
      data: {
        vaultId: vault.id,
        ownerId: userId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        nickname: dto.nickname,
        photo: dto.photo,
        bio: dto.bio,
        company: dto.company,
        jobTitle: dto.jobTitle,
        birthday: dto.birthday ? new Date(dto.birthday) : undefined,
        birthdayMonth: dto.birthday ? new Date(dto.birthday).getUTCMonth() + 1 : undefined,
        birthdayDay: dto.birthday ? new Date(dto.birthday).getUTCDate() : undefined,
        anniversary: dto.anniversary ? new Date(dto.anniversary) : undefined,
        labels: dto.labels || [],
        tags: dto.tags || [],
        groups: dto.groups || [],
        socialLinks: dto.socialLinks as Prisma.InputJsonObject | undefined,
        firstMetDate: dto.firstMetDate ? new Date(dto.firstMetDate) : undefined,
        firstMetContext: dto.firstMetContext,
        importance: dto.importance,
        preferredCadenceDays: dto.preferredCadenceDays,
        contactFields: contactFields ? { create: contactFields } : undefined,
      },
      select: contactDetailSelect(userId),
    });

    return {
      ...contact,
      socialLinks: parseSocialLinks(contact.socialLinks),
    };
  }

  async createForAgent(
    userId: string,
    input: AgentContactCreateInput,
    transaction: Prisma.TransactionClient,
  ) {
    const vault = await transaction.vault.findFirst({
      where: { ownerId: userId },
      select: { id: true },
    });
    if (!vault) throw new NotFoundException('No vault found');

    const existing = await transaction.contact.findFirst({
      where: {
        ownerId: userId,
        isDemo: false,
        firstName: { equals: input.firstName, mode: 'insensitive' },
        ...(input.lastName
          ? { lastName: { equals: input.lastName, mode: 'insensitive' } }
          : { OR: [{ lastName: null }, { lastName: '' }] }),
      },
      select: { id: true },
    });
    if (existing) throw new ConflictException('Contact already exists');

    const created = await transaction.contact.create({
      data: {
        vaultId: vault.id,
        ownerId: userId,
        firstName: input.firstName,
        lastName: input.lastName,
        nickname: input.nickname,
        labels: input.labels ?? [],
        tags: input.tags ?? [],
        groups: input.groups ?? [],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        nickname: true,
        labels: true,
        tags: true,
        groups: true,
        createdAt: true,
      },
    });

    return { ...created, createdAt: created.createdAt.toISOString() };
  }

  async findAll(userId: string, query: ContactQueryDto) {
    const where: Prisma.ContactWhereInput = { ownerId: userId, isDemo: false };

    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { nickname: { contains: query.search, mode: 'insensitive' } },
        { company: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.label) {
      where.labels = { has: query.label };
    }

    if (query.tag) {
      where.tags = { has: query.tag };
    }

    if (query.group) {
      where.groups = { has: query.group };
    }

    if (query.vaultId) {
      where.vaultId = query.vaultId;
    }

    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = query.offset ?? 0;
    const sortBy = Object.values(ContactSortBy).includes(query.sortBy)
      ? query.sortBy
      : ContactSortBy.CREATED_AT;
    const sortOrder = query.sortOrder === SortOrder.ASC ? SortOrder.ASC : SortOrder.DESC;

    const [contacts, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: [{ [sortBy]: sortOrder }, { id: SortOrder.ASC }],
        select: CONTACT_LIST_SELECT,
      }),
      this.prisma.contact.count({ where }),
    ]);

    return {
      contacts,
      total,
      offset,
      limit,
    };
  }

  async findOne(userId: string, contactId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, ownerId: userId, isDemo: false },
      select: contactDetailSelect(userId),
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    return {
      ...contact,
      socialLinks: parseSocialLinks(contact.socialLinks),
    };
  }

  async update(userId: string, contactId: string, dto: UpdateContactDto) {
    const { birthday, anniversary, firstMetDate, socialLinks, contactFields, ...scalarData } = dto;
    const updateData: Prisma.ContactUpdateInput = { ...scalarData };

    if (birthday !== undefined) {
      updateData.birthday = birthday === null ? null : new Date(birthday);
      updateData.birthdayMonth = birthday === null ? null : new Date(birthday).getUTCMonth() + 1;
      updateData.birthdayDay = birthday === null ? null : new Date(birthday).getUTCDate();
    }
    if (anniversary !== undefined) {
      updateData.anniversary = anniversary === null ? null : new Date(anniversary);
    }
    if (firstMetDate !== undefined) {
      updateData.firstMetDate = firstMetDate === null ? null : new Date(firstMetDate);
    }
    if (socialLinks !== undefined) {
      updateData.socialLinks = socialLinks as Prisma.InputJsonObject;
    }
    if (contactFields !== undefined) {
      updateData.contactFields = {
        deleteMany: {},
        create: normalizeContactFields(contactFields),
      };
    }

    const updated = await this.prisma.$transaction(
      async (tx) => {
        const contact = await tx.contact.findFirst({
          where: { id: contactId, ownerId: userId, isDemo: false },
          select: { id: true },
        });

        if (!contact) throw new NotFoundException('Contact not found');

        return tx.contact.update({
          where: { id: contactId },
          data: updateData,
          select: contactDetailSelect(userId),
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      ...updated,
      socialLinks: parseSocialLinks(updated.socialLinks),
    };
  }

  async delete(userId: string, contactId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, ownerId: userId },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    await this.prisma.contact.delete({
      where: { id: contactId },
    });

    return { success: true };
  }

  async getLabels(userId: string) {
    const contacts = await this.prisma.contact.findMany({
      where: { ownerId: userId, isDemo: false },
      select: { labels: true },
    });

    const labelSet = new Set<string>();
    contacts.forEach((c) => c.labels.forEach((l) => labelSet.add(l)));

    return Array.from(labelSet).sort();
  }

  async getTags(userId: string) {
    const contacts = await this.prisma.contact.findMany({
      where: { ownerId: userId, isDemo: false },
      select: { tags: true },
    });

    const tagSet = new Set<string>();
    contacts.forEach((c) => c.tags.forEach((t) => tagSet.add(t)));

    return Array.from(tagSet).sort();
  }

  async getGroups(userId: string) {
    const contacts = await this.prisma.contact.findMany({
      where: { ownerId: userId, isDemo: false },
      select: { groups: true },
    });

    const groups = new Set(contacts.flatMap((contact) => contact.groups));
    return Array.from(groups).sort();
  }

  async getDueContacts(userId: string, days = 14, limit = 20) {
    const staleDate = new Date();
    staleDate.setDate(staleDate.getDate() - days);

    const contacts = await this.prisma.contact.findMany({
      where: {
        ownerId: userId,
        isDemo: false,
        OR: [
          { lastContactedAt: { lt: staleDate } },
          {
            lastContactedAt: null,
            createdAt: { lt: staleDate },
          },
        ],
      },
      take: limit,
      orderBy: { lastContactedAt: 'asc' },
      include: {
        _count: {
          select: { interactions: true },
        },
      },
    });

    return contacts.map((contact) => ({
      ...contact,
      daysSinceContact: contact.lastContactedAt
        ? Math.floor((Date.now() - contact.lastContactedAt.getTime()) / (1000 * 60 * 60 * 24))
        : Math.floor((Date.now() - contact.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
      socialLinks: parseSocialLinks(contact.socialLinks),
    }));
  }

}
