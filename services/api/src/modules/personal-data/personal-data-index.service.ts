import { createHmac, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const KEY_LENGTH = 32;
const MAC_PATTERN = /^[0-9a-f]{64}$/;
const CONFIGURATION_ERROR = "Invalid personal data index configuration";

@Injectable()
export class PersonalDataIndexService {
  private key: Buffer | undefined;

  constructor(private readonly configService: ConfigService) {}

  validateConfiguration(): void {
    this.getKey();
  }

  private getKey(): Buffer {
    if (this.key) return this.key;
    this.key = decodeCanonicalKey(
      this.configService.get<string>("PERSONAL_DATA_INDEX_KEY")
    );
    return this.key;
  }

  mac(purpose: string, ownerId: string, canonicalValue: string): string {
    return createHmac("sha256", this.getKey())
      .update(`socos:index:v1:${purpose}:${ownerId}\0${canonicalValue}`, "utf8")
      .digest("hex");
  }

  verify(
    mac: string,
    purpose: string,
    ownerId: string,
    canonicalValue: string
  ): boolean {
    if (typeof mac !== "string" || !MAC_PATTERN.test(mac)) {
      return false;
    }

    const presented = Buffer.from(mac, "hex");
    const expected = Buffer.from(
      this.mac(purpose, ownerId, canonicalValue),
      "hex"
    );
    return timingSafeEqual(presented, expected);
  }
}

function decodeCanonicalKey(raw: unknown): Buffer {
  if (typeof raw !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    throw configurationError();
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH || key.toString("base64") !== raw) {
    throw configurationError();
  }
  return key;
}

function configurationError(): Error {
  return new Error(CONFIGURATION_ERROR);
}
