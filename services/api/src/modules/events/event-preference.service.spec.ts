import { BadRequestException } from "@nestjs/common";
import { EventPreferenceService } from "./event-preference.service.js";

describe("EventPreferenceService", () => {
  it("uses the existing record ID for encrypted tag updates and owner-scopes the write", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ id: "preference-1" })
      .mockResolvedValueOnce({
        id: "preference-1",
        maxDistanceKm: 25,
        travelSpeedKph: 30,
        travelBufferMinutes: 15,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      });
    const cipher = {
      encrypt: jest.fn(() => ({
        ciphertext: Buffer.from("cipher"),
        iv: Buffer.alloc(12),
        tag: Buffer.alloc(16),
        keyVersion: 1,
      })),
    };
    const service = new EventPreferenceService(
      {
        eventPreference: {
          findUnique,
          updateMany,
        },
      } as never,
      cipher as never,
      { requireEnabled: jest.fn() } as never,
      () => "new-preference"
    );

    const result = await service.upsert("owner-1", {
      interestTags: [" Learning ", "community", "Learning"],
      maxDistanceKm: 25,
    });

    expect(cipher.encrypt).toHaveBeenCalledWith(
      "event-preference-interest-tags",
      "owner-1",
      "preference-1",
      ["Learning", "community"]
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "preference-1", ownerId: "owner-1" },
      data: expect.objectContaining({ maxDistanceKm: 25 }),
    });
    expect(JSON.stringify(result)).not.toMatch(/cipher|ownerId/);
  });

  it("re-encrypts with the winner ID after a concurrent first-create conflict", async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "winner-id" })
      .mockResolvedValueOnce({
        id: "winner-id",
        maxDistanceKm: 50,
        travelSpeedKph: 30,
        travelBufferMinutes: 15,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      });
    const create = jest.fn().mockRejectedValue({ code: "P2002" });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const cipher = {
      encrypt: jest.fn(() => ({
        ciphertext: Buffer.from("cipher"),
        iv: Buffer.alloc(12),
        tag: Buffer.alloc(16),
        keyVersion: 1,
      })),
    };
    const service = new EventPreferenceService(
      { eventPreference: { findUnique, create, updateMany } } as never,
      cipher as never,
      { requireEnabled: jest.fn() } as never,
      () => "loser-id"
    );

    await service.upsert("owner-1", { interestTags: ["learning"] });

    expect(cipher.encrypt).toHaveBeenNthCalledWith(
      1,
      "event-preference-interest-tags",
      "owner-1",
      "loser-id",
      ["learning"]
    );
    expect(cipher.encrypt).toHaveBeenNthCalledWith(
      2,
      "event-preference-interest-tags",
      "owner-1",
      "winner-id",
      ["learning"]
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "winner-id", ownerId: "owner-1" },
      })
    );
  });

  it("returns a sanitized 400 for service-level tag validation", async () => {
    const service = new EventPreferenceService(
      {} as never,
      {} as never,
      { requireEnabled: jest.fn() } as never,
      () => "id"
    );
    const privateTag = "sensitive-" + "x".repeat(101);

    let thrown: unknown;
    try {
      await service.upsert("owner-1", { interestTags: [privateTag] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BadRequestException);
    expect(
      JSON.stringify((thrown as BadRequestException).getResponse())
    ).not.toContain(privateTag);
  });

  it("rejects a distance above the database maximum before persistence", async () => {
    const service = new EventPreferenceService(
      {} as never,
      {} as never,
      { requireEnabled: jest.fn() } as never,
      () => "id"
    );

    await expect(
      service.upsert("owner-1", { interestTags: [], maxDistanceKm: 501 })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
