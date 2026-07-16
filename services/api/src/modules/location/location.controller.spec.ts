import { HttpStatus } from "@nestjs/common";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import {
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
