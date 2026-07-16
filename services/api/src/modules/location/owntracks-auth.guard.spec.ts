import {
  ServiceUnavailableException,
  UnauthorizedException,
  type ExecutionContext,
} from "@nestjs/common";
import { OwnTracksAuthGuard } from "./owntracks-auth.guard.js";

const USERNAME = "u".repeat(32);
const PASSWORD = "p".repeat(43);

describe("OwnTracksAuthGuard", () => {
  let prisma: any;
  let config: any;
  let credentials: any;
  let guard: OwnTracksAuthGuard;

  beforeEach(() => {
    prisma = { locationDevice: { findUnique: jest.fn() } };
    config = { requireEnabled: jest.fn() };
    credentials = { verify: jest.fn() };
    guard = new OwnTracksAuthGuard(prisma, config, credentials);
  });

  it("uses only the Basic username locator and ignores X-Limit identity headers", async () => {
    const request: any = {
      headers: {
        authorization: basic(USERNAME, PASSWORD),
        "x-limit-u": "other-owner",
        "x-limit-d": "other-device",
      },
    };
    prisma.locationDevice.findUnique.mockResolvedValue({
      id: "internal-device-id",
      ownerId: "resolved-owner-id",
      credentialHash: "stored-hash",
      status: "active",
    });
    credentials.verify.mockResolvedValue(true);

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(prisma.locationDevice.findUnique).toHaveBeenCalledWith({
      where: { username: USERNAME },
      select: { id: true, ownerId: true, credentialHash: true, status: true },
    });
    expect(credentials.verify).toHaveBeenCalledWith(PASSWORD, "stored-hash");
    expect(request.locationDevice).toEqual({
      id: "internal-device-id",
      ownerId: "resolved-owner-id",
      username: USERNAME,
    });
  });

  it("does not query or run scrypt when ingest is disabled", async () => {
    config.requireEnabled.mockImplementation(() => {
      throw new ServiceUnavailableException({
        code: "integration_not_configured",
        message: "Integration is not configured",
      });
    });

    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: basic(USERNAME, PASSWORD) } })
      )
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.locationDevice.findUnique).not.toHaveBeenCalled();
    expect(credentials.verify).not.toHaveBeenCalled();
  });

  it("does not run scrypt for an unknown username", async () => {
    prisma.locationDevice.findUnique.mockResolvedValue(null);

    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: basic(USERNAME, PASSWORD) } })
      )
    ).rejects.toMatchObject(unauthorizedShape());
    expect(credentials.verify).not.toHaveBeenCalled();
  });

  it.each([
    ["missing header", undefined, null, false],
    ["wrong scheme", "Bearer token", null, false],
    ["malformed base64", "Basic !!!", null, false],
    [
      "missing colon",
      `Basic ${Buffer.from(USERNAME).toString("base64")}`,
      null,
      false,
    ],
    [
      "wrong password",
      basic(USERNAME, "wrong"),
      {
        id: "device",
        ownerId: "owner",
        credentialHash: "hash",
        status: "active",
      },
      false,
    ],
    [
      "revoked device",
      basic(USERNAME, PASSWORD),
      {
        id: "device",
        ownerId: "owner",
        credentialHash: "hash",
        status: "revoked",
      },
      true,
    ],
  ])(
    "returns the constant unauthorized shape for %s",
    async (_case, header, row, verified) => {
      prisma.locationDevice.findUnique.mockResolvedValue(row);
      credentials.verify.mockResolvedValue(verified);

      let failure: unknown;
      try {
        await guard.canActivate(
          contextFor({ headers: { authorization: header } })
        );
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(UnauthorizedException);
      expect(failure).toMatchObject(unauthorizedShape());
    }
  );
});

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function unauthorizedShape() {
  return {
    response: {
      statusCode: 401,
      code: "invalid_device_credentials",
      message: "Unauthorized",
    },
  };
}

function contextFor(request: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}
