import { createDecipheriv } from "node:crypto";
import type { ConfigService } from "@nestjs/config";
import { PersonalDataCipherService } from "./personal-data-cipher.service.js";
import type { EncryptedValue } from "./personal-data-cipher.service.js";

const KEY_ONE = Buffer.alloc(32, 0x11);
const KEY_TWO = Buffer.alloc(32, 0x22);
const OWNER_ID = "synthetic-owner";
const RECORD_ID = "synthetic-record";
const PURPOSE = "calendar-details";

function keyring(
  entries: Array<{ version: number; key: Buffer }> = [
    { version: 1, key: KEY_ONE },
  ]
): string {
  return JSON.stringify(
    entries.map(({ version, key }) => ({
      version,
      key: key.toString("base64"),
    }))
  );
}

function createConfig(keys?: string, activeVersion?: string): ConfigService {
  const configuredKeys = arguments.length >= 1 ? keys : keyring();
  const configuredActiveVersion = arguments.length >= 2 ? activeVersion : "1";

  return {
    get: jest.fn((name: string) => {
      if (name === "PERSONAL_DATA_KEYS") return configuredKeys;
      if (name === "PERSONAL_DATA_ACTIVE_KEY_VERSION") {
        return configuredActiveVersion;
      }
      return undefined;
    }),
  } as unknown as ConfigService;
}

function readPlaintext(value: EncryptedValue, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, value.iv);
  decipher.setAAD(
    Buffer.from(`socos:v1:${PURPOSE}:${OWNER_ID}:${RECORD_ID}`, "utf8")
  );
  decipher.setAuthTag(value.tag);
  return Buffer.concat([
    decipher.update(value.ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

function errorMessage(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected operation to fail");
}

describe("PersonalDataCipherService", () => {
  describe("configuration", () => {
    it.each([
      ["missing keyring", undefined],
      ["malformed JSON", "not-json"],
      ["object instead of array", "{}"],
      ["empty keyring", "[]"],
      [
        "trailing entry field",
        JSON.stringify([
          {
            version: 1,
            key: KEY_ONE.toString("base64"),
            label: "unexpected",
          },
        ]),
      ],
      [
        "string version",
        JSON.stringify([{ version: "1", key: KEY_ONE.toString("base64") }]),
      ],
      [
        "non-integer version",
        JSON.stringify([{ version: 1.5, key: KEY_ONE.toString("base64") }]),
      ],
      [
        "zero version",
        JSON.stringify([{ version: 0, key: KEY_ONE.toString("base64") }]),
      ],
      [
        "negative version",
        JSON.stringify([{ version: -1, key: KEY_ONE.toString("base64") }]),
      ],
      ["non-string key", JSON.stringify([{ version: 1, key: 123 }])],
      ["invalid base64", JSON.stringify([{ version: 1, key: "***" }])],
      [
        "non-canonical base64",
        JSON.stringify([
          { version: 1, key: KEY_ONE.toString("base64").replace(/=$/, "") },
        ]),
      ],
      [
        "wrong key length",
        JSON.stringify([
          { version: 1, key: Buffer.alloc(31, 0x11).toString("base64") },
        ]),
      ],
    ])("rejects a %s", (_label, keys) => {
      const service = new PersonalDataCipherService(createConfig(keys));
      expect(() => service.validateConfiguration()).toThrow(
        "Invalid personal data encryption configuration"
      );
    });

    it("rejects duplicate key versions", () => {
      const service = new PersonalDataCipherService(
        createConfig(
          keyring([
            { version: 1, key: KEY_ONE },
            { version: 1, key: KEY_TWO },
          ])
        )
      );
      expect(() => service.validateConfiguration()).toThrow(
        "Invalid personal data encryption configuration"
      );
    });

    it.each([undefined, "", "0", "-1", "+1", "01", "1.0", " 1", "2"])(
      "rejects missing, malformed, or absent active version %p",
      (activeVersion) => {
        const service = new PersonalDataCipherService(
          createConfig(keyring(), activeVersion)
        );
        expect(() => service.validateConfiguration()).toThrow(
          "Invalid personal data encryption configuration"
        );
      }
    );

    it("does not reveal key configuration in errors", () => {
      const invalidKeyring = JSON.stringify([
        { version: 1, key: "synthetic-sensitive-key-material" },
      ]);

      const service = new PersonalDataCipherService(
        createConfig(invalidKeyring)
      );
      const message = errorMessage(() => service.validateConfiguration());

      expect(message).toBe("Invalid personal data encryption configuration");
      expect(message).not.toContain("synthetic-sensitive-key-material");
    });

    it("defers missing configuration so disabled modules can initialize", () => {
      expect(
        () => new PersonalDataCipherService(createConfig(undefined, undefined))
      ).not.toThrow();
    });
  });

  it("encrypts with the active key and decrypts values encrypted with an old key", () => {
    const oldWriter = new PersonalDataCipherService(
      createConfig(keyring([{ version: 1, key: KEY_ONE }]), "1")
    );
    const service = new PersonalDataCipherService(
      createConfig(
        keyring([
          { version: 1, key: KEY_ONE },
          { version: 2, key: KEY_TWO },
        ]),
        "2"
      )
    );
    const oldValue = oldWriter.encrypt(
      PURPOSE,
      OWNER_ID,
      RECORD_ID,
      "old value"
    );

    const newValue = service.encrypt(PURPOSE, OWNER_ID, RECORD_ID, "new value");

    expect(newValue.keyVersion).toBe(2);
    expect(service.decrypt(PURPOSE, OWNER_ID, RECORD_ID, oldValue)).toBe(
      "old value"
    );
    expect(service.decrypt(PURPOSE, OWNER_ID, RECORD_ID, newValue)).toBe(
      "new value"
    );
  });

  it("uses a fresh 12-byte IV and a 16-byte tag for every encryption", () => {
    const service = new PersonalDataCipherService(createConfig());

    const first = service.encrypt(PURPOSE, OWNER_ID, RECORD_ID, {
      value: "same",
    });
    const second = service.encrypt(PURPOSE, OWNER_ID, RECORD_ID, {
      value: "same",
    });

    expect(first.iv).toHaveLength(12);
    expect(second.iv).toHaveLength(12);
    expect(first.tag).toHaveLength(16);
    expect(second.tag).toHaveLength(16);
    expect(first.iv.equals(second.iv)).toBe(false);
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
  });

  it.each([
    ["purpose", "other-purpose", OWNER_ID, RECORD_ID],
    ["owner", PURPOSE, "other-owner", RECORD_ID],
    ["record", PURPOSE, OWNER_ID, "other-record"],
  ])(
    "isolates ciphertext by exact %s AAD",
    (_label, purpose, ownerId, recordId) => {
      const service = new PersonalDataCipherService(createConfig());
      const encrypted = service.encrypt(PURPOSE, OWNER_ID, RECORD_ID, {
        private: "synthetic-private-value",
      });

      expect(() =>
        service.decrypt(purpose, ownerId, recordId, encrypted)
      ).toThrow("Personal data decryption failed");
    }
  );

  it.each([
    ["non-buffer ciphertext", { ciphertext: "invalid" }],
    ["empty ciphertext", { ciphertext: Buffer.alloc(0) }],
    ["short IV", { iv: Buffer.alloc(11) }],
    ["long IV", { iv: Buffer.alloc(13) }],
    ["non-buffer IV", { iv: "invalid" }],
    ["short tag", { tag: Buffer.alloc(15) }],
    ["long tag", { tag: Buffer.alloc(17) }],
    ["non-buffer tag", { tag: "invalid" }],
    ["zero key version", { keyVersion: 0 }],
    ["fractional key version", { keyVersion: 1.5 }],
    ["unknown key version", { keyVersion: 2 }],
  ])("rejects a malformed envelope with %s", (_label, replacement) => {
    const service = new PersonalDataCipherService(createConfig());
    const encrypted = service.encrypt(
      PURPOSE,
      OWNER_ID,
      RECORD_ID,
      "synthetic-value"
    );
    const malformed = { ...encrypted, ...replacement } as EncryptedValue;

    expect(() =>
      service.decrypt(PURPOSE, OWNER_ID, RECORD_ID, malformed)
    ).toThrow("Personal data decryption failed");
  });

  it("serializes canonical JSON and round trips nested JSON values", () => {
    const service = new PersonalDataCipherService(createConfig());
    const value = {
      z: 1,
      a: { y: true, x: [3, { b: 2, a: 1 }, null] },
    };

    const encrypted = service.encrypt(PURPOSE, OWNER_ID, RECORD_ID, value);

    expect(readPlaintext(encrypted, KEY_ONE)).toBe(
      '{"a":{"x":[3,{"a":1,"b":2},null],"y":true},"z":1}'
    );
    expect(service.decrypt(PURPOSE, OWNER_ID, RECORD_ID, encrypted)).toEqual(
      value
    );
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, BigInt(1)])(
    "rejects non-JSON plaintext %p with a redacted error",
    (value) => {
      const service = new PersonalDataCipherService(createConfig());

      expect(() =>
        service.encrypt(PURPOSE, OWNER_ID, RECORD_ID, value)
      ).toThrow("Personal data encryption failed");
    }
  );

  it("redacts authentication and payload failures", () => {
    const service = new PersonalDataCipherService(createConfig());
    const encrypted = service.encrypt(PURPOSE, OWNER_ID, RECORD_ID, {
      private: "synthetic-private-value",
    });
    const tampered = {
      ...encrypted,
      ciphertext: Buffer.from(encrypted.ciphertext),
    };
    tampered.ciphertext[0] ^= 0xff;

    const message = errorMessage(() =>
      service.decrypt(PURPOSE, OWNER_ID, RECORD_ID, tampered)
    );

    expect(message).toBe("Personal data decryption failed");
    expect(message).not.toContain(PURPOSE);
    expect(message).not.toContain(OWNER_ID);
    expect(message).not.toContain(RECORD_ID);
    expect(message).not.toContain("synthetic-private-value");
    expect(message).not.toContain(encrypted.ciphertext.toString("hex"));
  });
});
