import { randomUUID } from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DeviceCredentialService } from "../personal-data/device-credential.service.js";
import { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import { PersonalDataIndexService } from "../personal-data/personal-data-index.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CreateLocationDeviceDto } from "./location.dto.js";

const NAME_PURPOSE = "location-device-name";
const EXTERNAL_ID_PURPOSE = "location-device-external-id";

const DEVICE_PUBLIC_SELECT = {
  id: true,
  status: true,
  rawRetentionDays: true,
  derivedRetentionDays: true,
  lastSeenAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const DEVICE_LIST_SELECT = {
  ...DEVICE_PUBLIC_SELECT,
  ownerId: true,
  nameCiphertext: true,
  nameIv: true,
  nameTag: true,
  nameKeyVersion: true,
  externalDeviceIdCiphertext: true,
  externalDeviceIdIv: true,
  externalDeviceIdTag: true,
  externalDeviceIdKeyVersion: true,
} as const;

@Injectable()
export class LocationDeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: PersonalDataConfigService,
    private readonly cipher: PersonalDataCipherService,
    private readonly index: PersonalDataIndexService,
    private readonly credentials: DeviceCredentialService
  ) {}

  async create(ownerId: string, input: CreateLocationDeviceDto) {
    this.config.requireEnabled("locationIngest");

    const id = randomUUID();
    const issued = await this.credentials.generate();
    const name = this.cipher.encrypt(NAME_PURPOSE, ownerId, id, input.name);
    const externalId = this.cipher.encrypt(
      EXTERNAL_ID_PURPOSE,
      ownerId,
      id,
      input.externalDeviceId
    );
    const device = await this.prisma.locationDevice.create({
      data: {
        id,
        ownerId,
        nameMac: this.index.mac(NAME_PURPOSE, ownerId, input.name),
        nameCiphertext: name.ciphertext as Uint8Array<ArrayBuffer>,
        nameIv: name.iv as Uint8Array<ArrayBuffer>,
        nameTag: name.tag as Uint8Array<ArrayBuffer>,
        nameKeyVersion: name.keyVersion,
        username: issued.username,
        credentialHash: issued.passwordHash,
        externalDeviceIdMac: this.index.mac(
          EXTERNAL_ID_PURPOSE,
          ownerId,
          input.externalDeviceId
        ),
        externalDeviceIdCiphertext:
          externalId.ciphertext as Uint8Array<ArrayBuffer>,
        externalDeviceIdIv: externalId.iv as Uint8Array<ArrayBuffer>,
        externalDeviceIdTag: externalId.tag as Uint8Array<ArrayBuffer>,
        externalDeviceIdKeyVersion: externalId.keyVersion,
        ...(input.rawRetentionDays === undefined
          ? {}
          : { rawRetentionDays: input.rawRetentionDays }),
        ...(input.derivedRetentionDays === undefined
          ? {}
          : { derivedRetentionDays: input.derivedRetentionDays }),
      },
      select: DEVICE_PUBLIC_SELECT,
    });

    return {
      device: {
        ...device,
        name: input.name,
        externalDeviceId: input.externalDeviceId,
      },
      credentials: { username: issued.username, password: issued.password },
    };
  }

  async list(ownerId: string) {
    this.config.requireEnabled("locationIngest");
    const devices = await this.prisma.locationDevice.findMany({
      where: { ownerId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: DEVICE_LIST_SELECT,
    });

    return devices.map((device) => ({
      id: device.id,
      name: this.cipher.decrypt<string>(NAME_PURPOSE, ownerId, device.id, {
        ciphertext: Buffer.from(device.nameCiphertext),
        iv: Buffer.from(device.nameIv),
        tag: Buffer.from(device.nameTag),
        keyVersion: device.nameKeyVersion,
      }),
      externalDeviceId: this.cipher.decrypt<string>(
        EXTERNAL_ID_PURPOSE,
        ownerId,
        device.id,
        {
          ciphertext: Buffer.from(device.externalDeviceIdCiphertext),
          iv: Buffer.from(device.externalDeviceIdIv),
          tag: Buffer.from(device.externalDeviceIdTag),
          keyVersion: device.externalDeviceIdKeyVersion,
        }
      ),
      status: device.status,
      rawRetentionDays: device.rawRetentionDays,
      derivedRetentionDays: device.derivedRetentionDays,
      lastSeenAt: device.lastSeenAt,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt,
    }));
  }

  async rotate(ownerId: string, deviceId: string) {
    this.config.requireEnabled("locationIngest");
    const issued = await this.credentials.generate();
    const device = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.locationDevice.findFirst({
        where: { id: deviceId, ownerId, status: "active" },
        select: { ...DEVICE_PUBLIC_SELECT, username: true },
      });
      if (!current) throw new NotFoundException("Location device not found");

      const updated = await transaction.locationDevice.updateMany({
        where: {
          id: deviceId,
          ownerId,
          status: "active",
          username: current.username,
        },
        data: {
          username: issued.username,
          credentialHash: issued.passwordHash,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          statusCode: 409,
          code: "credential_rotation_conflict",
          message: "Credential rotation conflict",
        });
      }
      const { username: _username, ...publicDevice } = current;
      return publicDevice;
    });

    return {
      device,
      credentials: { username: issued.username, password: issued.password },
    };
  }

  async revoke(ownerId: string, deviceId: string): Promise<void> {
    this.config.requireEnabled("locationIngest");
    const result = await this.prisma.locationDevice.updateMany({
      where: { id: deviceId, ownerId, status: "active" },
      data: { status: "revoked" },
    });
    if (result.count !== 1) {
      throw new NotFoundException("Location device not found");
    }
  }
}
