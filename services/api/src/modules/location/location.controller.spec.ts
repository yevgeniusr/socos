import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import {
  LocationAliasController,
  LocationContextController,
  LocationDeviceController,
  OwnTracksController,
} from "./location.controller.js";

describe("LocationDeviceController", () => {
  const request = { user: { userId: "jwt-owner" } };
  let devices: any;
  let controller: LocationDeviceController;

  beforeEach(() => {
    devices = {
      create: jest
        .fn()
        .mockResolvedValue({ credentials: { password: "once" } }),
      list: jest.fn().mockResolvedValue([]),
      rotate: jest
        .fn()
        .mockResolvedValue({ credentials: { password: "once" } }),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    controller = new LocationDeviceController(devices);
  });

  it("derives the creation owner only from the authenticated JWT request", async () => {
    const input = {
      name: "Synthetic Pixel",
      externalDeviceId: "pixel-synthetic",
    };

    await controller.create(request, input);

    expect(devices.create).toHaveBeenCalledWith("jwt-owner", input);
  });

  it("derives list, rotation, and revocation ownership only from the JWT request", async () => {
    await controller.list(request);
    await controller.rotate(request, "device-id");
    await controller.revoke(request, "device-id");

    expect(devices.list).toHaveBeenCalledWith("jwt-owner");
    expect(devices.rotate).toHaveBeenCalledWith("jwt-owner", "device-id");
    expect(devices.revoke).toHaveBeenCalledWith("jwt-owner", "device-id");
  });

  it("returns 204 for revocation", () => {
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        LocationDeviceController.prototype.revoke
      )
    ).toBe(HttpStatus.NO_CONTENT);
  });
});

describe("OwnTracksController", () => {
  it("passes only the guard-resolved device and validated object and returns 200 []", async () => {
    const ingest = { ingest: jest.fn().mockResolvedValue([]) };
    const controller = new OwnTracksController(ingest as any);
    const device = {
      id: "internal-device",
      ownerId: "resolved-owner",
      username: "u".repeat(32),
    };
    const request = {
      locationDevice: device,
      headers: { "x-limit-u": "other-owner", "x-limit-d": "other-device" },
    };
    const input = { _type: "location" as const, tst: 1, lat: 1, lon: 2 };

    await expect(controller.ingest(request, input)).resolves.toEqual([]);

    expect(ingest.ingest).toHaveBeenCalledWith(device, input);
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        OwnTracksController.prototype.ingest
      )
    ).toBe(HttpStatus.OK);
  });
});

describe("human location context controllers", () => {
  const request = { user: { userId: "jwt-owner" } };

  it("derives every alias owner from JWT and forwards presentation DTOs only", async () => {
    const aliases = {
      create: jest.fn().mockResolvedValue({}),
      list: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new LocationAliasController(aliases as any);
    const create = {
      alias: "Synthetic",
      city: "City",
      countryCode: "AE",
      timeZone: "UTC",
    };
    const patch = { city: "Updated" };

    await controller.create(request, create);
    await controller.list(request);
    await controller.update(request, "alias-id", patch);
    await controller.remove(request, "alias-id");

    expect(aliases.create).toHaveBeenCalledWith("jwt-owner", create);
    expect(aliases.list).toHaveBeenCalledWith("jwt-owner");
    expect(aliases.update).toHaveBeenCalledWith("jwt-owner", "alias-id", patch);
    expect(aliases.remove).toHaveBeenCalledWith("jwt-owner", "alias-id");
  });

  it("returns only the coordinate-free current context whitelist", async () => {
    const context = {
      current: jest.fn().mockResolvedValue({
        source: "sample",
        city: null,
        countryCode: null,
        timeZone: null,
        distanceCapability: true,
        lastSeenAt: new Date("2026-07-16T12:00:00.000Z"),
        origin: { lat: 1, lon: 2 },
        coordinatesCiphertext: "forbidden",
      }),
    };
    const controller = new LocationContextController(context as any);

    const result = await controller.current(request);

    expect(context.current).toHaveBeenCalledWith("jwt-owner");
    expect(result).toEqual({
      source: "sample",
      city: null,
      countryCode: null,
      timeZone: null,
      distanceCapability: true,
      lastSeenAt: new Date("2026-07-16T12:00:00.000Z"),
    });
    expect(JSON.stringify(result)).not.toContain("lat");
    expect(JSON.stringify(result)).not.toContain("cipher");
  });
});
