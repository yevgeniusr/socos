import { Buffer } from "node:buffer";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import type { EventCatalogQueryDto } from "./event-catalog.dto.js";

export const EVENT_CATALOG_CLOCK = Symbol("EVENT_CATALOG_CLOCK");
export type EventCatalogClock = () => Date;

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const listingNotFound = () =>
  new NotFoundException("Event catalog listing not found");

const listingFields = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  aliases: true,
  tags: true,
  kind: true,
  status: true,
  geographicScope: true,
  countries: true,
  subdivisions: true,
  city: true,
  online: true,
  trustTier: true,
  dateCertainty: true,
  provenanceUrl: true,
  sourceRevision: true,
  checkedAt: true,
  freshnessSlaHours: true,
  license: true,
  attribution: true,
  updatedAt: true,
  connectorReference: false,
  contentHash: false,
} as const;

const occurrenceFields = {
  id: true,
  title: true,
  startAt: true,
  endAt: true,
  timeZone: true,
  city: true,
  countryCode: true,
} as const;

@Injectable()
export class EventCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_CATALOG_CLOCK)
    private readonly clock: EventCatalogClock = () => new Date()
  ) {}

  async search(ownerId: string, input: EventCatalogQueryDto) {
    const limit = boundedLimit(input.limit);
    const cursorSlug = decodeCursor(input.cursor);
    const q = optionalTrimmed(input.q);
    const tags = normalizedList(input.tags);
    const kind = optionalNormalized(input.kind);
    const country = optionalTrimmed(input.country)?.toUpperCase();
    const city = optionalTrimmed(input.city);
    const trust = optionalNormalized(input.trust);
    const and: Prisma.EventCatalogListingWhereInput[] = [];

    if (cursorSlug) and.push({ slug: { gt: cursorSlug } });
    if (q) {
      and.push({
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { summary: { contains: q, mode: "insensitive" } },
          { aliases: { has: q.toLowerCase() } },
        ],
      });
    }
    if (tags.length > 0) and.push({ tags: { hasEvery: tags } });
    if (kind) and.push({ kind });
    if (country) and.push({ countries: { has: country } });
    if (city) and.push({ city: { equals: city, mode: "insensitive" } });
    if (trust) and.push({ trustTier: trust });
    if (input.followed === "true") {
      and.push({ follows: { some: { ownerId } } });
    } else if (input.followed === "false") {
      and.push({ follows: { none: { ownerId } } });
    }

    const rows = await this.prisma.eventCatalogListing.findMany({
      where: { status: "active", AND: and },
      orderBy: { slug: "asc" },
      take: limit + 1,
      select: {
        ...listingFields,
        follows: {
          where: { ownerId },
          select: { status: true, socialWeight: true },
          take: 1,
        },
      },
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map(presentListing),
      nextCursor:
        hasMore && page.length > 0
          ? encodeCursor(page[page.length - 1].slug)
          : null,
    };
  }

  async getBySlug(ownerId: string, slug: string) {
    if (!slugPattern.test(slug)) throw listingNotFound();
    const row = await this.prisma.eventCatalogListing.findUnique({
      where: { slug },
      select: {
        ...listingFields,
        follows: {
          where: { ownerId },
          select: {
            status: true,
            socialWeight: true,
            source: {
              select: {
                events: {
                  where: {
                    ownerId,
                    status: "scheduled",
                    startAt: { gte: this.clock() },
                  },
                  orderBy: [{ startAt: "asc" }, { id: "asc" }],
                  take: 1,
                  select: occurrenceFields,
                },
              },
            },
          },
          take: 1,
        },
      },
    });
    if (!row || row.status !== "active") throw listingNotFound();
    const presented = presentListing(row);
    return {
      ...presented,
      nextOccurrence: row.follows[0]?.source.events[0] ?? null,
    };
  }
}

function presentListing<
  T extends {
    follows: Array<{ status: string; socialWeight: number }>;
  },
>(row: T) {
  const { follows, ...listing } = row;
  const follow = follows[0];
  return {
    ...listing,
    followed: Boolean(follow),
    follow: follow
      ? { status: follow.status, socialWeight: follow.socialWeight }
      : null,
  };
}

function optionalTrimmed(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function optionalNormalized(value: string | undefined): string | undefined {
  return optionalTrimmed(value)?.toLowerCase();
}

function normalizedList(value: string | undefined): string[] {
  if (!value) return [];
  const normalized = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(normalized)].sort();
}

function boundedLimit(value: number | undefined): number {
  return Number.isInteger(value) && value! >= 1 && value! <= 50 ? value! : 20;
}

function encodeCursor(slug: string): string {
  return Buffer.from(JSON.stringify({ version: 1, slug })).toString("base64url");
}

function decodeCursor(cursor: string | undefined): string | undefined {
  if (!cursor) return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { version?: unknown }).version !== 1 ||
      typeof (parsed as { slug?: unknown }).slug !== "string" ||
      !slugPattern.test((parsed as { slug: string }).slug)
    ) {
      throw new Error("invalid cursor");
    }
    return (parsed as { slug: string }).slug;
  } catch {
    throw new BadRequestException("Invalid event catalog cursor");
  }
}
