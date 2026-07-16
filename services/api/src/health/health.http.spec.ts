import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AllExceptionsFilter } from "../common/filters/http-exception.filter.js";
import { PrismaService } from "../modules/prisma/prisma.service.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";

describe("Health attestation HTTP contract", () => {
  let app: INestApplication;
  let endpoint: string;
  const prisma = {
    $queryRaw: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [HealthService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    endpoint = `http://127.0.0.1:${address.port}/api/health-check`;
  });

  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  it("serves the exact unauthenticated Betabots response with no-store caching", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ "?column?": 1 }]);

    const response = await fetch(`${endpoint}/postgresql`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      mode: "real",
      auth: { mode: "real" },
      database: {
        connected: true,
        driver: "postgres",
        persistent: true,
      },
      mocksDetected: false,
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("serves a sanitized no-store 503 through the production exception filter", async () => {
    const sensitiveValues = [
      "synthetic-user",
      "synthetic-secret",
      "private-db.internal",
      "private_schema",
      "postgresql://",
      "Synthetic query exception",
    ];
    prisma.$queryRaw.mockRejectedValueOnce(
      new Error(
        `Synthetic query exception: postgresql://${sensitiveValues[0]}:${sensitiveValues[1]}@${sensitiveValues[2]}/${sensitiveValues[3]}`
      )
    );

    const response = await fetch(`${endpoint}/postgresql`);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      statusCode: 503,
      message: "Service Unavailable Exception",
      timestamp: expect.any(String),
      path: "/api/health-check/postgresql",
    });
    expect(new Date(body.timestamp as string).toISOString()).toBe(
      body.timestamp
    );
    const serialized = JSON.stringify(body);
    for (const sensitive of sensitiveValues) {
      expect(serialized).not.toContain(sensitive);
    }
    for (const forbidden of [
      "stack",
      "latency",
      "version",
      "count",
      "databaseName",
      "environment",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("preserves the legacy process health response over HTTP", async () => {
    const response = await fetch(endpoint);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({
      status: "ok",
      timestamp: expect.any(String),
      version: "0.1.0",
    });
    expect(new Date(body.timestamp as string).toISOString()).toBe(
      body.timestamp
    );
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
