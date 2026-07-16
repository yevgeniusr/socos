import { ConflictException, NotFoundException } from "@nestjs/common";
import {
  canonicalLocationAlias,
  LocationAliasService,
} from "./location-alias.service.js";

const OWNER = "owner-synthetic";
const ALIAS_ID = "alias-synthetic";
const ENVELOPE = {
  ciphertext: Buffer.from("synthetic ciphertext"),
  iv: Buffer.alloc(12, 1),
  tag: Buffer.alloc(16, 2),
  keyVersion: 1,
};

describe("canonicalLocationAlias", () => {
  it("uses NFKC, trim, whitespace collapse, and en-US lower casing", () => {
    expect(canonicalLocationAlias("  ＨＯＭＥ\t Cafe\u0301  ")).toBe(
      "home café"
    );
  });
});

describe("LocationAliasService", () => {
  let tx: any;
  let prisma: any;
  let cipher: any;
  let index: any;
  let service: LocationAliasService;

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ acquired: 1 }]),
      locationAlias: {
        create: jest.fn().mockImplementation(({ data }: any) => ({
          ...data,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        })),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      cityStay: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      calendarEvent: { findMany: jest.fn().mockResolvedValue([]) },
    };
    prisma = {
      $transaction: jest.fn((operation: any) => operation(tx)),
      locationAlias: { findMany: jest.fn().mockResolvedValue([]) },
    };
    cipher = {
      encrypt: jest.fn().mockReturnValue(ENVELOPE),
      decrypt: jest.fn().mockReturnValue("Synthetic Alias"),
    };
    index = { mac: jest.fn().mockReturnValue("a".repeat(64)) };
    service = new LocationAliasService(prisma, cipher, index);
  });

  it("encrypts trimmed NFC display text with a pre-generated ID and owner MAC", async () => {
    const result = await service.create(OWNER, {
      alias: "  Cafe\u0301  ",
      city: "Synthetic City",
      countryCode: "AE",
      timeZone: "Asia/Dubai",
    });

    const data = tx.locationAlias.create.mock.calls[0][0].data;
    expect(cipher.encrypt).toHaveBeenCalledWith(
      "location-alias",
      OWNER,
      data.id,
      "Café"
    );
    expect(index.mac).toHaveBeenCalledWith("location-alias", OWNER, "café");
    expect(data).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        ownerId: OWNER,
        aliasMac: "a".repeat(64),
        aliasCiphertext: ENVELOPE.ciphertext,
        aliasIv: ENVELOPE.iv,
        aliasTag: ENVELOPE.tag,
        aliasKeyVersion: 1,
      })
    );
    expect(result).toEqual(
      expect.objectContaining({ alias: "Café", city: "Synthetic City" })
    );
    expect(result).not.toHaveProperty("ownerId");
    expect(result).not.toHaveProperty("aliasMac");
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.cityStay.deleteMany).toHaveBeenCalledWith({
      where: { ownerId: OWNER, source: "calendar" },
    });
  });

  it("lists and decrypts only owner-scoped presentation rows", async () => {
    prisma.locationAlias.findMany.mockResolvedValue([
      storedAlias({ ownerId: OWNER }),
    ]);

    const result = await service.list(OWNER);

    expect(prisma.locationAlias.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: OWNER } })
    );
    expect(cipher.decrypt).toHaveBeenCalledWith(
      "location-alias",
      OWNER,
      ALIAS_ID,
      ENVELOPE
    );
    expect(result[0]).not.toHaveProperty("ownerId");
    expect(result[0]).not.toHaveProperty("aliasCiphertext");
  });

  it("reuses the record ID/AAD on update and returns missing for cross-owner IDs", async () => {
    tx.locationAlias.findFirst.mockResolvedValueOnce(storedAlias());

    await service.update(OWNER, ALIAS_ID, { alias: "  Updated  " });

    expect(tx.locationAlias.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ALIAS_ID, ownerId: OWNER } })
    );
    expect(cipher.encrypt).toHaveBeenCalledWith(
      "location-alias",
      OWNER,
      ALIAS_ID,
      "Updated"
    );
    expect(tx.locationAlias.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ALIAS_ID, ownerId: OWNER } })
    );

    tx.locationAlias.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.update("other-owner", ALIAS_ID, { city: "Other" })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("deletes by owner and maps canonical duplicate conflicts to a sanitized 409", async () => {
    await service.remove(OWNER, ALIAS_ID);
    expect(tx.locationAlias.deleteMany).toHaveBeenCalledWith({
      where: { id: ALIAS_ID, ownerId: OWNER },
    });

    tx.locationAlias.create.mockRejectedValue({
      code: "P2002",
      meta: { target: ["ownerId", "aliasMac"] },
    });
    await expect(
      service.create(OWNER, {
        alias: "Synthetic Alias",
        city: "City",
        countryCode: "AE",
        timeZone: "UTC",
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rebuilds only exact owner aliases for selected eligible calendar events", async () => {
    tx.locationAlias.findMany.mockResolvedValue([
      storedAlias({ aliasMac: "match-mac", city: "Matched City" }),
    ]);
    tx.calendarEvent.findMany.mockResolvedValue([
      calendarEvent("eligible", "confirmed"),
      calendarEvent("declined", "confirmed"),
      calendarEvent("cancelled", "cancelled"),
    ]);
    cipher.decrypt.mockImplementation(
      (purpose: string, _owner: string, id: string) => {
        if (purpose === "calendar-event-details") {
          return {
            summary: "Synthetic",
            locationText: id === "eligible" ? " SYNTHETIC ALIAS " : "Other",
            selfResponseStatus: id === "declined" ? "declined" : "accepted",
          };
        }
        return "Synthetic Alias";
      }
    );
    index.mac.mockImplementation(
      (_purpose: string, _owner: string, canonical: string) =>
        canonical === "synthetic alias" ? "match-mac" : "other-mac"
    );

    await service.rebuildCalendarStays(OWNER);

    expect(tx.calendarEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ownerId: OWNER,
          status: { not: "cancelled" },
          source: { is: { ownerId: OWNER, selected: true } },
        }),
      })
    );
    expect(tx.cityStay.createMany).toHaveBeenCalledWith({
      data: [
        {
          ownerId: OWNER,
          startsAt: new Date("2026-02-01T10:00:00.000Z"),
          endsAt: new Date("2026-02-01T11:00:00.000Z"),
          city: "Matched City",
          countryCode: "AE",
          timeZone: "Asia/Dubai",
          source: "calendar",
          sourceId: "eligible",
          confidence: 1,
        },
      ],
    });
  });
});

function storedAlias(overrides: Record<string, unknown> = {}) {
  return {
    id: ALIAS_ID,
    ownerId: OWNER,
    aliasMac: "a".repeat(64),
    aliasCiphertext: ENVELOPE.ciphertext,
    aliasIv: ENVELOPE.iv,
    aliasTag: ENVELOPE.tag,
    aliasKeyVersion: 1,
    city: "Synthetic City",
    countryCode: "AE",
    timeZone: "Asia/Dubai",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function calendarEvent(id: string, status: string) {
  return {
    id,
    ownerId: OWNER,
    status,
    startAt: new Date("2026-02-01T10:00:00.000Z"),
    endAt: new Date("2026-02-01T11:00:00.000Z"),
    detailsCiphertext: Buffer.from(id),
    detailsIv: Buffer.alloc(12),
    detailsTag: Buffer.alloc(16),
    detailsKeyVersion: 1,
  };
}
