import type { ConfigService } from "@nestjs/config";
import { PersonalDataIndexService } from "./personal-data-index.service.js";

const crypto = jest.requireActual<typeof import("node:crypto")>("node:crypto");

const INDEX_KEY = Buffer.alloc(32, 0x31);
const PURPOSE = "calendar-external-id";
const OWNER_ID = "synthetic-owner";
const CANONICAL_VALUE = "synthetic-canonical-value";

function createConfig(indexKey?: string): ConfigService {
  const configuredKey =
    arguments.length >= 1 ? indexKey : INDEX_KEY.toString("base64");

  return {
    get: jest.fn((name: string) => {
      if (name === "PERSONAL_DATA_INDEX_KEY") return configuredKey;
      return undefined;
    }),
  } as unknown as ConfigService;
}

function errorMessage(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected operation to fail");
}

describe("PersonalDataIndexService", () => {
  describe("configuration", () => {
    it.each([
      ["missing key", undefined],
      ["empty key", ""],
      ["invalid base64", "not-base64"],
      ["missing padding", INDEX_KEY.toString("base64").replace(/=$/, "")],
      ["extra padding", `${INDEX_KEY.toString("base64")}=`],
      ["surrounding whitespace", ` ${INDEX_KEY.toString("base64")}`],
      [
        "base64url alphabet",
        Buffer.alloc(32, 0xff).toString("base64").replaceAll("/", "_"),
      ],
      ["31-byte key", Buffer.alloc(31, 0x31).toString("base64")],
      ["33-byte key", Buffer.alloc(33, 0x31).toString("base64")],
    ])("rejects a %s", (_label, indexKey) => {
      expect(
        () => new PersonalDataIndexService(createConfig(indexKey))
      ).toThrow("Invalid personal data index configuration");
    });

    it("does not reveal index key material in errors", () => {
      const invalidKey = "synthetic-sensitive-index-key-material";

      const message = errorMessage(
        () => new PersonalDataIndexService(createConfig(invalidKey))
      );

      expect(message).toBe("Invalid personal data index configuration");
      expect(message).not.toContain(invalidKey);
    });
  });

  it("uses the exact versioned, domain-separated MAC input", () => {
    const service = new PersonalDataIndexService(createConfig());
    const expected = crypto
      .createHmac("sha256", INDEX_KEY)
      .update(
        Buffer.from(
          `socos:index:v1:${PURPOSE}:${OWNER_ID}\0${CANONICAL_VALUE}`,
          "utf8"
        )
      )
      .digest("hex");

    expect(service.mac(PURPOSE, OWNER_ID, CANONICAL_VALUE)).toBe(expected);
  });

  it.each([
    ["purpose", "location-external-id", OWNER_ID, CANONICAL_VALUE],
    ["owner", PURPOSE, "other-synthetic-owner", CANONICAL_VALUE],
    ["canonical value", PURPOSE, OWNER_ID, "other-canonical-value"],
  ])(
    "isolates MACs by exact %s input",
    (_label, purpose, ownerId, canonicalValue) => {
      const service = new PersonalDataIndexService(createConfig());
      const original = service.mac(PURPOSE, OWNER_ID, CANONICAL_VALUE);

      expect(service.mac(purpose, ownerId, canonicalValue)).not.toBe(original);
    }
  );

  it("returns a lowercase 64-character hexadecimal MAC", () => {
    const service = new PersonalDataIndexService(createConfig());

    const mac = service.mac(PURPOSE, OWNER_ID, CANONICAL_VALUE);

    expect(mac).toMatch(/^[0-9a-f]{64}$/);
  });

  it("uses timing-safe comparison for valid stored MACs", () => {
    const service = new PersonalDataIndexService(createConfig());
    const storedMac = service.mac(PURPOSE, OWNER_ID, CANONICAL_VALUE);
    const timingSafeEqual = jest.spyOn(crypto, "timingSafeEqual");

    try {
      expect(
        service.verify(storedMac, PURPOSE, OWNER_ID, CANONICAL_VALUE)
      ).toBe(true);
      expect(
        service.verify(storedMac, PURPOSE, OWNER_ID, "different-value")
      ).toBe(false);
      expect(timingSafeEqual).toHaveBeenCalledTimes(2);
      for (const [presented, expected] of timingSafeEqual.mock.calls) {
        expect(Buffer.isBuffer(presented)).toBe(true);
        expect(Buffer.isBuffer(expected)).toBe(true);
        expect(presented).toHaveLength(32);
        expect(expected).toHaveLength(32);
      }
    } finally {
      timingSafeEqual.mockRestore();
    }
  });

  it.each([
    ["empty", ""],
    ["too short", "a".repeat(63)],
    ["too long", "a".repeat(65)],
    ["uppercase", "A".repeat(64)],
    ["non-hex", "g".repeat(64)],
    ["surrounding whitespace", ` ${"a".repeat(64)}`],
    ["non-string", 123 as unknown as string],
  ])("rejects a malformed %s stored MAC", (_label, storedMac) => {
    const service = new PersonalDataIndexService(createConfig());
    const timingSafeEqual = jest.spyOn(crypto, "timingSafeEqual");

    try {
      expect(
        service.verify(storedMac, PURPOSE, OWNER_ID, CANONICAL_VALUE)
      ).toBe(false);
      expect(timingSafeEqual).not.toHaveBeenCalled();
    } finally {
      timingSafeEqual.mockRestore();
    }
  });
});
