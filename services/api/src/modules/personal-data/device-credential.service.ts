import * as crypto from "node:crypto";
import { Injectable } from "@nestjs/common";

const USERNAME_BYTES = 24;
const PASSWORD_BYTES = 32;
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const STORED_HASH_PATTERN =
  /^scrypt\$32768\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{43})$/;

export type DeviceCredential = {
  username: string;
  password: string;
  passwordHash: string;
};

@Injectable()
export class DeviceCredentialService {
  async generate(): Promise<DeviceCredential> {
    const username = crypto.randomBytes(USERNAME_BYTES).toString("base64url");
    const password = crypto.randomBytes(PASSWORD_BYTES).toString("base64url");
    const salt = crypto.randomBytes(SALT_BYTES);
    const hash = await derive(password, salt);

    return {
      username,
      password,
      passwordHash: `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${hash.toString("base64url")}`,
    };
  }

  async verify(password: string, storedHash: string): Promise<boolean> {
    if (typeof password !== "string" || typeof storedHash !== "string") {
      return false;
    }

    const match = STORED_HASH_PATTERN.exec(storedHash);
    if (!match) return false;

    const salt = decodeCanonicalBase64Url(match[1], SALT_BYTES);
    const expected = decodeCanonicalBase64Url(match[2], HASH_BYTES);
    if (!salt || !expected) return false;

    try {
      const presented = await derive(password, salt);
      return crypto.timingSafeEqual(presented, expected);
    } catch {
      return false;
    }
  }
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      HASH_BYTES,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      }
    );
  });
}

function decodeCanonicalBase64Url(
  encoded: string,
  expectedLength: number
): Buffer | undefined {
  const decoded = Buffer.from(encoded, "base64url");
  if (
    decoded.length !== expectedLength ||
    decoded.toString("base64url") !== encoded
  ) {
    return undefined;
  }
  return decoded;
}
