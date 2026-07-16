import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import type { PrismaService } from "../modules/prisma/prisma.service.js";
import { HealthController } from "./health.controller.js";
import {
  DATABASE_ATTESTATION,
  DATABASE_ATTESTATION_UNAVAILABLE,
  HealthService,
} from "./health.service.js";

describe("HealthController", () => {
  it("preserves the existing process health-check contract", () => {
    const controller = new HealthController({} as HealthService);

    const result = controller.healthCheck();

    expect(result.status).toBe("ok");
    expect(result.version).toBe("0.1.0");
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  it("exposes an unauthenticated fixed PostgreSQL attestation with no-store metadata", async () => {
    const service = {
      databaseAttestation: jest.fn().mockResolvedValue(DATABASE_ATTESTATION),
    };
    const controller = new HealthController(
      service as unknown as HealthService
    );

    await expect(controller.postgresqlAttestation()).resolves.toEqual({
      mode: "real",
      auth: { mode: "real" },
      database: {
        connected: true,
        driver: "postgres",
        persistent: true,
      },
      mocksDetected: false,
    });
    expect(service.databaseAttestation).toHaveBeenCalledTimes(1);
    expect(
      Reflect.getMetadata(
        HEADERS_METADATA,
        HealthController.prototype.postgresqlAttestation
      )
    ).toEqual([{ name: "Cache-Control", value: "no-store" }]);
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        HealthController.prototype.postgresqlAttestation
      )
    ).toBe("postgresql");
    expect(
      Reflect.getMetadata(GUARDS_METADATA, HealthController)
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(
        GUARDS_METADATA,
        HealthController.prototype.postgresqlAttestation
      )
    ).toBeUndefined();
  });

  it("does not expose database error, host, schema, or credential details", async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockRejectedValue(
          new Error(
            "postgresql://synthetic-user:synthetic-secret@private-db.internal/private_schema"
          )
        ),
    };
    const controller = new HealthController(
      new HealthService(prisma as unknown as PrismaService)
    );

    let thrown: unknown;
    try {
      await controller.postgresqlAttestation();
    } catch (error) {
      thrown = error;
    }

    expect((thrown as { getStatus(): number }).getStatus()).toBe(503);
    expect((thrown as { getResponse(): unknown }).getResponse()).toEqual(
      DATABASE_ATTESTATION_UNAVAILABLE
    );
    expect(
      JSON.stringify((thrown as { getResponse(): unknown }).getResponse())
    ).toBe('{"status":"unavailable","attestation":"postgresql-unreachable"}');
  });
});
