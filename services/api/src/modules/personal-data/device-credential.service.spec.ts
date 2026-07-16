import type * as NodeCrypto from "node:crypto";
import { DeviceCredentialService } from "./device-credential.service.js";

const crypto = jest.requireActual<typeof NodeCrypto>("node:crypto");

describe("DeviceCredentialService", () => {
  const service = new DeviceCredentialService();

  it("generates opaque base64url credentials and stores only the fixed scrypt format", async () => {
    const credential = await service.generate();

    expect(credential.username).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(credential.password).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(credential.passwordHash).toMatch(
      /^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/
    );
    expect(credential.passwordHash).not.toContain(credential.password);
    expect(Buffer.from(credential.username, "base64url")).toHaveLength(24);
    expect(Buffer.from(credential.password, "base64url")).toHaveLength(32);
  });

  it("verifies the generated password and rejects a different password", async () => {
    const credential = await service.generate();

    await expect(
      service.verify(credential.password, credential.passwordHash)
    ).resolves.toBe(true);
    await expect(
      service.verify("different-synthetic-password", credential.passwordHash)
    ).resolves.toBe(false);
  });

  it("uses the required scrypt work factors and 64 MiB maximum memory", async () => {
    const scrypt = jest.spyOn(crypto, "scrypt");

    try {
      await service.generate();

      expect(scrypt).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Buffer),
        32,
        expect.objectContaining({
          N: 32768,
          r: 8,
          p: 1,
          maxmem: 64 * 1024 * 1024,
        }),
        expect.any(Function)
      );
    } finally {
      scrypt.mockRestore();
    }
  });

  it("compares equal-length derived hashes with timingSafeEqual", async () => {
    const credential = await service.generate();
    const timingSafeEqual = jest.spyOn(crypto, "timingSafeEqual");

    try {
      await service.verify(credential.password, credential.passwordHash);

      expect(timingSafeEqual).toHaveBeenCalledTimes(1);
      const [presented, expected] = timingSafeEqual.mock.calls[0];
      expect(Buffer.isBuffer(presented)).toBe(true);
      expect(Buffer.isBuffer(expected)).toBe(true);
      expect(presented).toHaveLength(32);
      expect(expected).toHaveLength(32);
    } finally {
      timingSafeEqual.mockRestore();
    }
  });

  it.each([
    "",
    "scrypt",
    "scrypt$32768$8$1$short$short",
    `scrypt$32767$8$1$${"a".repeat(22)}$${"b".repeat(43)}`,
    `scrypt$32768$7$1$${"a".repeat(22)}$${"b".repeat(43)}`,
    `scrypt$32768$8$2$${"a".repeat(22)}$${"b".repeat(43)}`,
    `scrypt$32768$8$1$${"+".repeat(22)}$${"b".repeat(43)}`,
    `scrypt$32768$8$1$${"a".repeat(22)}$${"=".repeat(43)}`,
    `scrypt$32768$8$1$${"a".repeat(22)}$${"b".repeat(43)}$extra`,
  ])(
    "rejects malformed stored hash %p without comparing",
    async (storedHash) => {
      const timingSafeEqual = jest.spyOn(crypto, "timingSafeEqual");

      try {
        await expect(
          service.verify("synthetic-password", storedHash)
        ).resolves.toBe(false);
        expect(timingSafeEqual).not.toHaveBeenCalled();
      } finally {
        timingSafeEqual.mockRestore();
      }
    }
  );
});
