import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { toGregorian } from "lunar";
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  CreateCelebrationPackDto,
  UpdateCelebrationPackDto,
  CreateCelebrationDto,
  UpdateCelebrationDto,
  AttachCelebrationDto,
  UpdateContactCelebrationDto,
  CelebrationQueryDto,
  GlobalStatusDto,
  SearchCelebrationsDto,
} from './celebrations.dto.js';
// ==================== LUNAR DATE HELPER ====================

function lunarToGregorian(
  lunarMonth: number,
  lunarDay: number,
  year: number,
): Date | null {
  try {
    // lunar.toGregorian expects { year, month, day } and returns { date: Date }
    const result = toGregorian({ year, month: lunarMonth, day: lunarDay });
    return result.date;
  } catch {
    return null;
  }
}

export function getGregorianDateForCelebration(
  celebration: { date: string; fullDate: Date | null; calendarType: string },
  targetYear: number,
): Date | null {
  const { date, fullDate, calendarType } = celebration;
  if (!['gregorian', 'lunar', 'chinese'].includes(calendarType)) return null;
  const match = /^(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1) return null;
  if (calendarType === 'lunar' || calendarType === 'chinese') {
    if (day > 30) return null;
  } else {
    const validationDate = new Date(Date.UTC(2000, month - 1, day));
    if (
      validationDate.getUTCMonth() !== month - 1 ||
      validationDate.getUTCDate() !== day
    ) {
      return null;
    }
  }

  if (fullDate) {
    if (Number.isNaN(fullDate.getTime())) return null;
    return new Date(
      Date.UTC(
        fullDate.getUTCFullYear(),
        fullDate.getUTCMonth(),
        fullDate.getUTCDate(),
      ),
    );
  }

  // For lunar/chinese calendars, compute the gregorian date
  if (calendarType === 'lunar' || calendarType === 'chinese') {
    // Get the gregorian date for this year's lunar date
    // Most lunar holidays are on the same lunar date each year, but move ~11 days earlier each year
    return lunarToGregorian(month, day, targetYear);
  }

  // Gregorian (fixed date)
  const result = new Date(Date.UTC(targetYear, month - 1, day));
  if (
    result.getUTCFullYear() !== targetYear ||
    result.getUTCMonth() !== month - 1 ||
    result.getUTCDate() !== day
  ) {
    return null;
  }
  return result;
}

// ==================== SERVICE ====================

@Injectable()
export class CelebrationsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // ==================== SEARCH ====================

  async searchCelebrations(userId: string, query: SearchCelebrationsDto) {
    const { q, category, packId, limit = 20 } = query;

    const where: any = {
      OR: [{ ownerId: null }, { ownerId: userId }],
    };

    if (q) {
      where.AND = {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    if (category) {
      where.category = category;
    }

    if (packId) {
      where.packId = packId;
    }

    const [celebrations, total] = await Promise.all([
      this.prisma.celebration.findMany({
        where,
        include: { pack: { select: { id: true, name: true } } },
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.celebration.count({ where }),
    ]);

    return {
      celebrations: celebrations.map((c) => ({
        ...c,
        isSystem: c.ownerId === null,
      })),
      total,
      query: q,
    };
  }

  // ==================== REMINDERS ====================

  async getReminderCelebrations(userId: string, days = 14) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + days);

    const toRemind: any[] = await this.prisma.contactCelebration.findMany({
      where: {
        ownerId: userId,
        status: 'active',
        shouldRemind: true,
        contact: { isDemo: false },
      },
      include: {
        celebration: {
          include: { pack: { select: { id: true, name: true } } },
        },
        contact: {
          select: { id: true, firstName: true, lastName: true, photo: true },
        },
      },
    });

    const reminders = [];

    for (const cc of toRemind) {
      const gregDate = getGregorianDateForCelebration(
        { date: cc.celebration.date, fullDate: cc.celebration.fullDate, calendarType: cc.celebration.calendarType },
        currentYear,
      );

      if (!gregDate) continue;

      if (gregDate < now || gregDate > endDate) {
        if (gregDate < now) {
          const nextYear = getGregorianDateForCelebration(
            { date: cc.celebration.date, fullDate: cc.celebration.fullDate, calendarType: cc.celebration.calendarType },
            currentYear + 1,
          );
          if (nextYear && nextYear <= endDate) {
            reminders.push(this.buildReminderItem(cc, nextYear, currentYear + 1, now));
          }
        }
        continue;
      }

      reminders.push(this.buildReminderItem(cc, gregDate, currentYear, now));
    }

    return reminders.sort((a, b) => a.daysUntil - b.daysUntil).slice(0, 50);
  }

  /**
   * Send email/SMS notifications for upcoming celebration reminders.
   * Returns a summary of notifications sent.
   */
  async sendCelebrationNotifications(userId: string, days = 14): Promise<{
    sent: number;
    errors: number;
    details: Array<{ contactName: string; celebrationName: string; sent: boolean; error?: string }>;
  }> {
    const upcoming = await this.getReminderCelebrations(userId, days);
    const details: Array<{ contactName: string; celebrationName: string; sent: boolean; error?: string }> = [];
    let sent = 0;
    let errors = 0;

    for (const item of upcoming) {
      try {
        await this.notifications.sendCelebrationNotification(userId, {
          contactName: item.contactName,
          celebrationName: item.celebrationName,
          reminderDate: item.nextOccurrence.toLocaleDateString(),
        });
        sent++;
        details.push({ contactName: item.contactName, celebrationName: item.celebrationName, sent: true });
      } catch (err) {
        errors++;
        details.push({ contactName: item.contactName, celebrationName: item.celebrationName, sent: false, error: String(err) });
      }
    }

    return { sent, errors, details };
  }

  private buildReminderItem(cc: any, occDate: Date, year: number, now: Date) {
    const contactName =
      [cc.contact.firstName, cc.contact.lastName].filter(Boolean).join(' ') ||
      'Unknown';
    return {
      contactId: cc.contact.id,
      contactName,
      contactAvatar: cc.contact.photo,
      celebrationId: cc.celebration.id,
      celebrationName: cc.celebration.name,
      celebrationIcon: cc.celebration.icon,
      calendarType: cc.celebration.calendarType,
      nextOccurrence: occDate,
      daysUntil: Math.ceil((occDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      year,
    };
  }

  // ==================== CELEBRATION PACKS ====================

  async findAllPacks(userId: string) {
    // Return system packs (ownerId=null) + user's own packs
    const packs = await this.prisma.celebrationPack.findMany({
      where: {
        OR: [
          { ownerId: null },
          { ownerId: userId },
        ],
      },
      include: {
        _count: {
          select: { celebrations: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return packs.map((pack) => ({
      ...pack,
      isSystem: pack.ownerId === null,
    }));
  }

  async findPackById(userId: string, packId: string) {
    const pack = await this.prisma.celebrationPack.findFirst({
      where: {
        id: packId,
        OR: [
          { ownerId: null },
          { ownerId: userId },
        ],
      },
      include: {
        celebrations: {
          orderBy: { date: 'asc' },
        },
      },
    });

    if (!pack) {
      throw new NotFoundException('Celebration pack not found');
    }

    return {
      ...pack,
      isSystem: pack.ownerId === null,
    };
  }

  async createPack(userId: string, dto: CreateCelebrationPackDto) {
    const pack = await this.prisma.celebrationPack.create({
      data: {
        ownerId: userId,
        name: dto.name,
        description: dto.description,
        isDefault: false,
      },
    });

    return { ...pack, isSystem: false };
  }

  async updatePack(userId: string, packId: string, dto: UpdateCelebrationPackDto) {
    const pack = await this.prisma.celebrationPack.findFirst({
      where: { id: packId, ownerId: userId },
    });

    if (!pack) {
      throw new NotFoundException('Celebration pack not found or not editable');
    }

    const updated = await this.prisma.celebrationPack.update({
      where: { id: packId },
      data: dto,
    });

    return { ...updated, isSystem: false };
  }

  async deletePack(userId: string, packId: string) {
    const pack = await this.prisma.celebrationPack.findFirst({
      where: { id: packId, ownerId: userId },
    });

    if (!pack) {
      throw new NotFoundException('Celebration pack not found or not deletable');
    }

    await this.prisma.celebrationPack.delete({
      where: { id: packId },
    });

    return { success: true };
  }

  // ==================== CELEBRATIONS ====================

  async findAllInPack(userId: string, packId: string, query: CelebrationQueryDto) {
    // Verify pack access
    const pack = await this.prisma.celebrationPack.findFirst({
      where: {
        id: packId,
        OR: [{ ownerId: null }, { ownerId: userId }],
      },
    });

    if (!pack) {
      throw new NotFoundException('Celebration pack not found');
    }

    const where: any = { packId };

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.category) {
      where.category = query.category;
    }

    // Only show system celebrations (ownerId=null) or user's own
    where.OR = [
      { ownerId: null },
      { ownerId: userId },
    ];

    const [celebrations, total] = await Promise.all([
      this.prisma.celebration.findMany({
        where,
        skip: query.offset || 0,
        take: query.limit || 50,
        orderBy: { date: 'asc' },
      }),
      this.prisma.celebration.count({ where }),
    ]);

    // Get user's global status for each celebration (from ContactCelebrations)
    const celebrationIds = celebrations.map((c) => c.id);
    const contactCelebrations = await this.prisma.contactCelebration.findMany({
      where: {
        celebrationId: { in: celebrationIds },
        ownerId: userId,
      },
      select: {
        celebrationId: true,
        status: true,
      },
    });

    const statusMap = new Map(contactCelebrations.map((cc) => [cc.celebrationId, cc.status]));

    return {
      pack: { id: pack.id, name: pack.name, isSystem: pack.ownerId === null },
      celebrations: celebrations.map((c) => ({
        ...c,
        isSystem: c.ownerId === null,
        userStatus: statusMap.get(c.id) || null,
      })),
      total,
      offset: query.offset || 0,
      limit: query.limit || 50,
    };
  }

  async findCelebrationById(userId: string, celebrationId: string) {
    const celebration = await this.prisma.celebration.findFirst({
      where: {
        id: celebrationId,
        OR: [{ ownerId: null }, { ownerId: userId }],
      },
      include: {
        pack: true,
      },
    });

    if (!celebration) {
      throw new NotFoundException('Celebration not found');
    }

    // Get user's status
    const contactCelebration = await this.prisma.contactCelebration.findFirst({
      where: {
        celebrationId,
        ownerId: userId,
      },
    });

    return {
      ...celebration,
      isSystem: celebration.ownerId === null,
      userStatus: contactCelebration?.status || null,
    };
  }

  async createCelebration(userId: string, packId: string, dto: CreateCelebrationDto) {
    // Verify user owns this pack
    const pack = await this.prisma.celebrationPack.findFirst({
      where: { id: packId, ownerId: userId },
    });

    if (!pack) {
      throw new ForbiddenException('You can only add celebrations to your own packs');
    }

    const celebration = await this.prisma.celebration.create({
      data: {
        packId,
        ownerId: userId,
        name: dto.name,
        description: dto.description,
        date: dto.date,
        fullDate: dto.fullDate ? new Date(dto.fullDate) : undefined,
        icon: dto.icon,
        category: dto.category,
      },
    });

    return { ...celebration, isSystem: false };
  }

  async updateCelebration(
    userId: string,
    packId: string,
    celebrationId: string,
    dto: UpdateCelebrationDto,
  ) {
    // Verify user owns this celebration (not a system one)
    const celebration = await this.prisma.celebration.findFirst({
      where: { id: celebrationId, packId, ownerId: userId },
    });

    if (!celebration) {
      throw new NotFoundException('Celebration not found or not editable');
    }

    const updateData: any = { ...dto };
    if (dto.fullDate) {
      updateData.fullDate = new Date(dto.fullDate);
    }

    const updated = await this.prisma.celebration.update({
      where: { id: celebrationId },
      data: updateData,
    });

    return { ...updated, isSystem: false };
  }

  async deleteCelebration(userId: string, packId: string, celebrationId: string) {
    const celebration = await this.prisma.celebration.findFirst({
      where: { id: celebrationId, packId, ownerId: userId },
    });

    if (!celebration) {
      throw new NotFoundException('Celebration not found or not deletable');
    }

    await this.prisma.celebration.delete({
      where: { id: celebrationId },
    });

    return { success: true };
  }

  // ==================== CONTACT CELEBRATIONS ====================

  async attachToContact(userId: string, contactId: string, dto: AttachCelebrationDto) {
    // Verify contact belongs to user
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, ownerId: userId },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    // Verify celebration exists and user has access
    const celebration = await this.prisma.celebration.findFirst({
      where: {
        id: dto.celebrationId,
        OR: [{ ownerId: null }, { ownerId: userId }],
      },
    });

    if (!celebration) {
      throw new NotFoundException('Celebration not found');
    }

    // Check if already attached
    const existing = await this.prisma.contactCelebration.findUnique({
      where: {
        contactId_celebrationId: {
          contactId,
          celebrationId: dto.celebrationId,
        },
      },
    });

    if (existing) {
      // Update existing
      const updated = await this.prisma.contactCelebration.update({
        where: { id: existing.id },
        data: {
          status: dto.status || 'active',
          customDate: dto.customDate ? new Date(dto.customDate) : undefined,
          shouldRemind: dto.shouldRemind ?? existing.shouldRemind,
        },
        include: { celebration: true },
      });
      return updated;
    }

    const contactCelebration = await this.prisma.contactCelebration.create({
      data: {
        contactId,
        celebrationId: dto.celebrationId,
        ownerId: userId,
        status: dto.status || 'active',
        customDate: dto.customDate ? new Date(dto.customDate) : undefined,
        shouldRemind: dto.shouldRemind ?? true,
      },
      include: { celebration: true },
    });

    return contactCelebration;
  }

  async findAllForContact(userId: string, contactId: string) {
    // Verify contact belongs to user
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, ownerId: userId },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const contactCelebrations = await this.prisma.contactCelebration.findMany({
      where: { contactId, ownerId: userId },
      include: {
        celebration: {
          include: { pack: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return contactCelebrations.map((cc) => ({
      id: cc.id,
      status: cc.status,
      shouldRemind: cc.shouldRemind,
      customDate: cc.customDate,
      createdAt: cc.createdAt,
      celebration: {
        ...cc.celebration,
        isSystem: cc.celebration.ownerId === null,
      },
    }));
  }

  async updateContactCelebration(
    userId: string,
    contactId: string,
    celebrationId: string,
    dto: UpdateContactCelebrationDto,
  ) {
    // Verify contact belongs to user
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, ownerId: userId },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const contactCelebration = await this.prisma.contactCelebration.findUnique({
      where: {
        contactId_celebrationId: {
          contactId,
          celebrationId,
        },
      },
    });

    if (!contactCelebration) {
      throw new NotFoundException('Celebration not attached to this contact');
    }

    const updateData: any = {};
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.customDate !== undefined) {
      updateData.customDate = dto.customDate ? new Date(dto.customDate) : null;
    }
    if (dto.shouldRemind !== undefined) updateData.shouldRemind = dto.shouldRemind;

    const updated = await this.prisma.contactCelebration.update({
      where: { id: contactCelebration.id },
      data: updateData,
      include: { celebration: true },
    });

    return updated;
  }

  async detachFromContact(userId: string, contactId: string, celebrationId: string) {
    // Verify contact belongs to user
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, ownerId: userId },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    const contactCelebration = await this.prisma.contactCelebration.findUnique({
      where: {
        contactId_celebrationId: {
          contactId,
          celebrationId,
        },
      },
    });

    if (!contactCelebration) {
      throw new NotFoundException('Celebration not attached to this contact');
    }

    await this.prisma.contactCelebration.delete({
      where: { id: contactCelebration.id },
    });

    return { success: true };
  }

  // ==================== GLOBAL STATUS (bulk update across all contacts) ====================

  async setGlobalStatus(userId: string, celebrationId: string, dto: GlobalStatusDto) {
    // Verify celebration exists and user has access
    const celebration = await this.prisma.celebration.findFirst({
      where: {
        id: celebrationId,
        OR: [{ ownerId: null }, { ownerId: userId }],
      },
    });

    if (!celebration) {
      throw new NotFoundException('Celebration not found');
    }

    // Update all ContactCelebrations for this user + celebration
    const result = await this.prisma.contactCelebration.updateMany({
      where: {
        celebrationId,
        ownerId: userId,
      },
      data: {
        status: dto.status,
      },
    });

    return {
      success: true,
      updatedCount: result.count,
      status: dto.status,
    };
  }

  // ==================== UPCOMING CELEBRATIONS ====================

  async getUpcoming(userId: string) {
    const now = new Date();
    const currentYear = now.getFullYear();

    // Get all contact celebrations for this user
    const contactCelebrations = await this.prisma.contactCelebration.findMany({
      where: {
        ownerId: userId,
        status: 'active',
        contact: { isDemo: false },
      },
      include: {
        celebration: {
          include: { pack: true },
        },
        contact: {
          select: { id: true, firstName: true, lastName: true, photo: true },
        },
      },
    });

    // Calculate upcoming dates (now with proper lunar calendar support)
    const upcoming = contactCelebrations
      .map((cc) => {
        let eventDate: Date | null;

        // Use custom date if set
        if (cc.customDate) {
          eventDate = new Date(cc.customDate);
          if (eventDate < now) {
            eventDate = new Date(eventDate.setFullYear(currentYear + 1));
          }
        } else {
          eventDate = getGregorianDateForCelebration(
            {
              date: cc.celebration.date,
              fullDate: cc.celebration.fullDate,
              calendarType: cc.celebration.calendarType,
            },
            currentYear,
          );
          if (!eventDate || eventDate < now) {
            const nextYearDate = getGregorianDateForCelebration(
              { date: cc.celebration.date, fullDate: cc.celebration.fullDate, calendarType: cc.celebration.calendarType },
              currentYear + 1,
            );
            if (nextYearDate) eventDate = nextYearDate;
          }
        }

        if (!eventDate) return null;

        return {
          id: cc.id,
          contactId: cc.contactId,
          contact: cc.contact,
          celebration: {
            ...cc.celebration,
            isSystem: cc.celebration.ownerId === null,
          },
          customDate: cc.customDate,
          upcomingDate: eventDate,
          daysUntil: Math.ceil((eventDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
        };
      })
      .filter((item) => item.daysUntil <= 30) // Within next 30 days
      .sort((a, b) => a.upcomingDate.getTime() - b.upcomingDate.getTime());

    return upcoming;
  }
}
