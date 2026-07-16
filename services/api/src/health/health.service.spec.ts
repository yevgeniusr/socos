import { ServiceUnavailableException } from "@nestjs/common";
import type { PrismaService } from "../modules/prisma/prisma.service.js";
import {
  DATABASE_ATTESTATION,
  DATABASE_ATTESTATION_UNAVAILABLE,
  HealthService,
} from "./health.service.js";

describe("HealthService database attestation", () => {
  function createService(queryResult: Promise<unknown>) {
    const prisma = {
      $queryRaw: jest.fn().mockReturnValue(queryResult),
    };
    return {
      prisma,
      service: new HealthService(prisma as unknown as PrismaService),
    };
  }

  it("executes one bounded PostgreSQL liveness query and returns the fixed attestation", async () => {
    const { prisma, service } = createService(
      Promise.resolve([{ "?column?": 1 }])
    );

    await expect(service.databaseAttestation()).resolves.toEqual(
      DATABASE_ATTESTATION
    );
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const query = prisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray;
    expect(Array.from(query).join("")).toBe("SELECT 1");
    expect(DATABASE_ATTESTATION).toEqual({
      mode: "real",
      auth: { mode: "real" },
      database: {
        connected: true,
        driver: "postgres",
        persistent: true,
      },
      mocksDetected: false,
    });
  });

  it("replaces database failures with a fixed sanitized 503 response", async () => {
    const sensitiveFailure =
      "postgresql://synthetic-user:synthetic-secret@private-db.internal:5432/private_schema";
    const { service } = createService(
      Promise.reject(new Error(sensitiveFailure))
    );

    let thrown: unknown;
    try {
      await service.databaseAttestation();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ServiceUnavailableException);
    const exception = thrown as ServiceUnavailableException;
    expect(exception.getStatus()).toBe(503);
    expect(exception.getResponse()).toEqual(DATABASE_ATTESTATION_UNAVAILABLE);

    const serialized = JSON.stringify(exception.getResponse());
    for (const forbidden of [
      "synthetic-user",
      "synthetic-secret",
      "private-db",
      "private_schema",
      "postgresql://",
      "stack",
      "latency",
      "version",
      "count",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
