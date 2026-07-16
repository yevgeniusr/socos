import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { LocationContextService } from "../location/location-context.service.js";
import {
  rankEventCandidates,
  type EventRankingCandidate,
  type EventRankingFeedback,
  type EventRankingPreferences,
  type RankedEventCandidate,
} from "./event-ranking.js";

const INTEREST_TAGS_PURPOSE = "event-preference-interest-tags";
const CALENDAR_EVENT_DETAILS_PURPOSE = "calendar-event-details";
const MAX_CANDIDATES = 200;
const MAX_CALENDAR_EVENTS = 500;
const MAX_CONTACTS = 500;
const MAX_FEEDBACK = 500;
const DAY_MS = 24 * 60 * 60 * 1_000;

type DbClient = PrismaService | Prisma.TransactionClient;

type PreferenceRow = {
  id: string;
  interestTagsCiphertext: Uint8Array;
  interestTagsIv: Uint8Array;
  interestTagsTag: Uint8Array;
  interestTagsKeyVersion: number;
  maxDistanceKm: unknown;
  travelSpeedKph: number;
  travelBufferMinutes: number;
};

type CandidateRow = {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  city: string | null;
  countryCode: string | null;
  latitude: unknown;
  longitude: unknown;
  category: string | null;
  tags: string[];
  source: {
    id: string;
    ownerId: string;
    status: string;
    socialWeight: number;
  };
};

type ContactRow = {
  id: string;
  labels: string[];
  tags: string[];
  groups: string[];
};

type CalendarEventRow = {
  id: string;
  status: string;
  startAt: Date | null;
  endAt: Date | null;
  transparency: string;
  detailsCiphertext: Uint8Array | null;
  detailsIv: Uint8Array | null;
  detailsTag: Uint8Array | null;
  detailsKeyVersion: number | null;
};

type CalendarEventDetails = {
  selfResponseStatus?: "accepted" | "declined" | "tentative" | "needsAction" | null;
};

type FeedbackRow = {
  action: string;
  createdAt: Date;
  snoozedUntil: Date | null;
  briefItem: {
    kind: string;
    sourceType: string;
    sourceId: string | null;
    evidence: unknown;
  } | null;
};

export type PlannedEventRecommendation = {
  kind: "event";
  contactId: null;
  sourceType: "discovered_event";
  sourceId: string;
  rank: number;
  score: number;
  title: string;
  reason: string;
  startAt: Date;
  endAt: Date;
  city: string | null;
  evidence: RankedEventCandidate["evidence"];
};

@Injectable()
export class EventRecommendationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: PersonalDataCipherService,
    private readonly locations: LocationContextService
  ) {}

  async recommend(
    ownerId: string,
    now = new Date(),
    transaction?: Prisma.TransactionClient
  ): Promise<PlannedEventRecommendation[]> {
    const db = transaction ?? this.prisma;
    const selectedSources = await db.calendarSource.findMany({
      where: { ownerId, selected: true },
      orderBy: [{ id: "asc" }],
      take: 100,
      select: { id: true, ownerId: true, selected: true, fullSyncRequired: true },
    });
    if (selectedSources.some((source) => source.fullSyncRequired)) return [];

    const preferences = await this.readPreferences(db, ownerId);
    const rows = (await db.discoveredEvent.findMany({
      where: {
        ownerId,
        status: "scheduled",
        endAt: { gt: now },
        source: {
          is: {
            ownerId,
            status: { in: ["active", "error"] },
          },
        },
      },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      take: MAX_CANDIDATES,
      select: {
        id: true,
        title: true,
        startAt: true,
        endAt: true,
        city: true,
        countryCode: true,
        latitude: true,
        longitude: true,
        category: true,
        tags: true,
        source: {
          select: {
            id: true,
            ownerId: true,
            status: true,
            socialWeight: true,
          },
        },
      },
    })) as CandidateRow[];
    if (rows.length === 0) return [];

    const [contacts, feedback] = await Promise.all([
      this.readContacts(db, ownerId),
      this.readFeedback(db, ownerId, now),
    ]);
    const contactTags = contactTagSets(contacts);
    const candidates: EventRankingCandidate[] = [];
    for (const row of rows) {
      const locationContext = await this.locations.resolveForEvent(
        ownerId,
        row.startAt,
        now,
        transaction
      );
      candidates.push({
        id: row.id,
        title: row.title,
        startAt: row.startAt,
        endAt: row.endAt,
        city: row.city,
        countryCode: row.countryCode,
        latitude: numericOrNull(row.latitude),
        longitude: numericOrNull(row.longitude),
        category: row.category,
        tags: row.tags,
        sourceSocialWeight: row.source.socialWeight,
        locationContext,
        matchedContactCount: matchedContactCount(row.tags, contactTags),
      });
    }

    const ranked = rankEventCandidates({
      now,
      preferences,
      candidates,
      feedback,
    });
    const clear: RankedEventCandidate[] = [];
    for (const candidate of ranked) {
      if (await this.hasCalendarConflict(db, ownerId, candidate, preferences)) {
        continue;
      }
      clear.push(candidate);
      if (clear.length === 3) break;
    }
    return clear.map((candidate, index) => plannedItem(candidate, index + 1));
  }

  private async readPreferences(
    db: DbClient,
    ownerId: string
  ): Promise<EventRankingPreferences> {
    const row = (await db.eventPreference.findUnique({
      where: { ownerId },
      select: {
        id: true,
        interestTagsCiphertext: true,
        interestTagsIv: true,
        interestTagsTag: true,
        interestTagsKeyVersion: true,
        maxDistanceKm: true,
        travelSpeedKph: true,
        travelBufferMinutes: true,
      },
    })) as PreferenceRow | null;
    if (!row) {
      return {
        interestTags: [],
        maxDistanceKm: 50,
        travelSpeedKph: 30,
        travelBufferMinutes: 15,
      };
    }
    return {
      interestTags: this.cipher.decrypt<string[]>(
        INTEREST_TAGS_PURPOSE,
        ownerId,
        row.id,
        {
          ciphertext: Buffer.from(row.interestTagsCiphertext),
          iv: Buffer.from(row.interestTagsIv),
          tag: Buffer.from(row.interestTagsTag),
          keyVersion: row.interestTagsKeyVersion,
        }
      ),
      maxDistanceKm: Number(row.maxDistanceKm),
      travelSpeedKph: row.travelSpeedKph,
      travelBufferMinutes: row.travelBufferMinutes,
    };
  }

  private async readContacts(db: DbClient, ownerId: string): Promise<ContactRow[]> {
    return (await db.contact.findMany({
      where: { ownerId, isDemo: false },
      orderBy: [{ id: "asc" }],
      take: MAX_CONTACTS,
      select: { id: true, labels: true, tags: true, groups: true },
    })) as ContactRow[];
  }

  private async readFeedback(
    db: DbClient,
    ownerId: string,
    now: Date
  ): Promise<EventRankingFeedback[]> {
    const rows = (await db.briefFeedback.findMany({
      where: {
        ownerId,
        action: { in: ["accept", "snooze", "dismiss"] },
        createdAt: { gte: new Date(now.getTime() - 90 * DAY_MS), lte: now },
        briefItem: {
          is: { ownerId, kind: "event", sourceType: "discovered_event" },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_FEEDBACK,
      select: {
        action: true,
        createdAt: true,
        snoozedUntil: true,
        briefItem: {
          select: {
            kind: true,
            sourceType: true,
            sourceId: true,
            evidence: true,
          },
        },
      },
    })) as FeedbackRow[];
    return rows
      .filter(
        (row) =>
          row.briefItem?.kind === "event" &&
          row.briefItem.sourceType === "discovered_event" &&
          ["accept", "snooze", "dismiss"].includes(row.action)
      )
      .map((row) => ({
        eventId: row.briefItem?.sourceId ?? null,
        category: evidenceCategory(row.briefItem?.evidence),
        action: row.action as EventRankingFeedback["action"],
        createdAt: row.createdAt,
        snoozedUntil: row.snoozedUntil,
      }));
  }

  private async hasCalendarConflict(
    db: DbClient,
    ownerId: string,
    candidate: RankedEventCandidate,
    preferences: EventRankingPreferences
  ): Promise<boolean> {
    const paddingMs =
      (Math.ceil(
        (candidate.travelDistanceKm / Math.max(1, preferences.travelSpeedKph)) * 60
      ) +
        preferences.travelBufferMinutes) *
      60 *
      1000;
    const windowStart = new Date(candidate.startAt.getTime() - paddingMs);
    const windowEnd = new Date(candidate.endAt.getTime() + paddingMs);
    const rows = (await db.calendarEvent.findMany({
      where: {
        ownerId,
        status: { not: "cancelled" },
        transparency: { not: "transparent" },
        startAt: { lt: windowEnd },
        endAt: { gt: windowStart },
        source: { is: { ownerId, selected: true } },
      },
      orderBy: [{ startAt: "asc" }, { id: "asc" }],
      take: MAX_CALENDAR_EVENTS,
      select: {
        id: true,
        status: true,
        startAt: true,
        endAt: true,
        transparency: true,
        detailsCiphertext: true,
        detailsIv: true,
        detailsTag: true,
        detailsKeyVersion: true,
      },
    })) as CalendarEventRow[];
    return rows.some((row) => this.isBusy(ownerId, row, windowStart, windowEnd));
  }

  private isBusy(
    ownerId: string,
    row: CalendarEventRow,
    windowStart: Date,
    windowEnd: Date
  ): boolean {
    if (
      row.status === "cancelled" ||
      row.transparency === "transparent" ||
      !row.startAt ||
      !row.endAt ||
      row.startAt.getTime() >= windowEnd.getTime() ||
      row.endAt.getTime() <= windowStart.getTime()
    ) {
      return false;
    }
    if (
      !row.detailsCiphertext ||
      !row.detailsIv ||
      !row.detailsTag ||
      row.detailsKeyVersion === null
    ) {
      return true;
    }
    const details = this.cipher.decrypt<CalendarEventDetails>(
      CALENDAR_EVENT_DETAILS_PURPOSE,
      ownerId,
      row.id,
      {
        ciphertext: Buffer.from(row.detailsCiphertext),
        iv: Buffer.from(row.detailsIv),
        tag: Buffer.from(row.detailsTag),
        keyVersion: row.detailsKeyVersion,
      }
    );
    return details.selfResponseStatus !== "declined";
  }
}

function plannedItem(
  candidate: RankedEventCandidate,
  rank: number
): PlannedEventRecommendation {
  return {
    kind: "event",
    contactId: null,
    sourceType: "discovered_event",
    sourceId: candidate.id,
    rank,
    score: candidate.score,
    title: candidate.title,
    reason: recommendationReason(candidate),
    startAt: candidate.startAt,
    endAt: candidate.endAt,
    city: candidate.city,
    evidence: candidate.evidence,
  };
}

function recommendationReason(candidate: RankedEventCandidate): string {
  const tags = candidate.evidence.matchedTags;
  if (tags.length > 0) return `Matches ${tags.slice(0, 2).join(", ")}`;
  if (candidate.evidence.category) return `${candidate.evidence.category} event nearby`;
  return "Public event nearby";
}

function evidenceCategory(evidence: unknown): string | null {
  if (typeof evidence !== "object" || evidence === null) return null;
  const category = (evidence as { category?: unknown }).category;
  return typeof category === "string" && category.trim()
    ? category.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US")
    : null;
}

function contactTagSets(rows: ContactRow[]): Set<string>[] {
  return rows.map(
    (row) =>
      new Set(
        [...row.labels, ...row.tags, ...row.groups].map(canonicalTag).filter(Boolean)
      )
  );
}

function matchedContactCount(eventTags: string[], contacts: Set<string>[]): number {
  const tags = new Set(eventTags.map(canonicalTag).filter(Boolean));
  return contacts.filter((contact) => intersects(tags, contact)).length;
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function canonicalTag(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
