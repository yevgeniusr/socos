import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { canonicalJson } from "../agent-security/canonical-json.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const CONFIGURATION_ERROR = "Invalid personal data encryption configuration";
const ENCRYPTION_ERROR = "Personal data encryption failed";
const DECRYPTION_ERROR = "Personal data decryption failed";

export type EncryptedValue = {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyVersion: number;
};

type KeyringEntry = {
  version: number;
  key: string;
};

@Injectable()
export class PersonalDataCipherService {
  private configuration:
    | { keys: ReadonlyMap<number, Buffer>; activeVersion: number }
    | undefined;

  constructor(private readonly configService: ConfigService) {}

  validateConfiguration(): void {
    this.getConfiguration();
  }

  private getConfiguration(): {
    keys: ReadonlyMap<number, Buffer>;
    activeVersion: number;
  } {
    if (this.configuration) return this.configuration;

    const keys = parseKeyring(
      this.configService.get<string>("PERSONAL_DATA_KEYS")
    );
    const activeVersion = parseActiveVersion(
      this.configService.get<string>("PERSONAL_DATA_ACTIVE_KEY_VERSION")
    );

    if (!keys.has(activeVersion)) {
      throw configurationError();
    }

    this.configuration = { keys, activeVersion };
    return this.configuration;
  }

  encrypt<T>(
    purpose: string,
    ownerId: string,
    recordId: string,
    value: T
  ): EncryptedValue {
    try {
      const { keys, activeVersion } = this.getConfiguration();
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv(ALGORITHM, keys.get(activeVersion)!, iv, {
        authTagLength: TAG_LENGTH,
      });
      cipher.setAAD(aad(purpose, ownerId, recordId));
      const ciphertext = Buffer.concat([
        cipher.update(canonicalJson(value), "utf8"),
        cipher.final(),
      ]);

      return {
        ciphertext,
        iv,
        tag: cipher.getAuthTag(),
        keyVersion: activeVersion,
      };
    } catch {
      throw new Error(ENCRYPTION_ERROR);
    }
  }

  decrypt<T>(
    purpose: string,
    ownerId: string,
    recordId: string,
    value: EncryptedValue
  ): T {
    try {
      const { keys } = this.getConfiguration();
      const key = validateEnvelope(value, keys);
      const decipher = createDecipheriv(ALGORITHM, key, value.iv, {
        authTagLength: TAG_LENGTH,
      });
      decipher.setAAD(aad(purpose, ownerId, recordId));
      decipher.setAuthTag(value.tag);
      const plaintext = Buffer.concat([
        decipher.update(value.ciphertext),
        decipher.final(),
      ]).toString("utf8");

      return JSON.parse(plaintext) as T;
    } catch {
      throw new Error(DECRYPTION_ERROR);
    }
  }
}

function parseKeyring(raw: unknown): Map<number, Buffer> {
  if (typeof raw !== "string") throw configurationError();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw configurationError();
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw configurationError();
  }

  const keys = new Map<number, Buffer>();
  for (const value of parsed) {
    if (!isKeyringEntry(value) || keys.has(value.version)) {
      throw configurationError();
    }

    const key = decodeCanonicalKey(value.key);
    keys.set(value.version, key);
  }
  return keys;
}

function isKeyringEntry(value: unknown): value is KeyringEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const entry = value as Record<string, unknown>;
  const fields = Object.keys(entry);
  return (
    fields.length === 2 &&
    fields.includes("version") &&
    fields.includes("key") &&
    Number.isSafeInteger(entry.version) &&
    (entry.version as number) > 0 &&
    typeof entry.key === "string"
  );
}

function decodeCanonicalKey(encoded: string): Buffer {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) {
    throw configurationError();
  }

  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_LENGTH || key.toString("base64") !== encoded) {
    throw configurationError();
  }
  return key;
}

function parseActiveVersion(raw: unknown): number {
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) {
    throw configurationError();
  }

  const version = Number(raw);
  if (!Number.isSafeInteger(version)) {
    throw configurationError();
  }
  return version;
}

function validateEnvelope(
  value: EncryptedValue,
  keys: ReadonlyMap<number, Buffer>
): Buffer {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(DECRYPTION_ERROR);
  }

  if (
    !Buffer.isBuffer(value.ciphertext) ||
    value.ciphertext.length === 0 ||
    !Buffer.isBuffer(value.iv) ||
    value.iv.length !== IV_LENGTH ||
    !Buffer.isBuffer(value.tag) ||
    value.tag.length !== TAG_LENGTH ||
    !Number.isSafeInteger(value.keyVersion) ||
    value.keyVersion <= 0
  ) {
    throw new Error(DECRYPTION_ERROR);
  }

  const key = keys.get(value.keyVersion);
  if (!key) throw new Error(DECRYPTION_ERROR);
  return key;
}

function aad(purpose: string, ownerId: string, recordId: string): Buffer {
  return Buffer.from(`socos:v1:${purpose}:${ownerId}:${recordId}`, "utf8");
}

function configurationError(): Error {
  return new Error(CONFIGURATION_ERROR);
}
