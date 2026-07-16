import {
  HttpStatus,
  RequestMethod,
  type INestApplication,
} from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { createApplicationValidationPipe } from "../../common/application-validation.pipe.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { AgentAuthController } from "./agent-auth.controller.js";
import { AgentAuthGuard } from "./agent-auth.guard.js";
import { AgentAuthModule } from "./agent-auth.module.js";
import { AgentAuthService } from "./agent-auth.service.js";

jest.mock("@socos/agent-core", () => ({
  AGENT_SCOPES: ["contacts:read", "briefs:read", "approvals:execute"],
}));

const request = { user: { userId: "owner-authenticated" } };

function routesFor(controller: object): string[] {
  return Object.getOwnPropertyNames(controller).flatMap((methodName) => {
    const handler = controller[methodName as keyof typeof controller];
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as
      | RequestMethod
      | undefined;
    const path = Reflect.getMetadata(PATH_METADATA, handler) as
      | string
      | undefined;
    return method === undefined || path === undefined
      ? []
      : [`${RequestMethod[method]} ${path}`];
  });
}

describe("AgentAuthController", () => {
  const service = {
    createClient: jest.fn(),
    listClients: jest.fn(),
    rotateClient: jest.fn(),
    revokeClient: jest.fn(),
  };
  const controller = new AgentAuthController(
    service as unknown as AgentAuthService
  );

  beforeEach(() => jest.clearAllMocks());

  it("publishes only the JWT-guarded management routes", () => {
    expect(Reflect.getMetadata(PATH_METADATA, AgentAuthController)).toBe(
      "agent-clients"
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, AgentAuthController)).toContain(
      AuthGuard
    );
    expect(routesFor(AgentAuthController.prototype).sort()).toEqual([
      "DELETE :clientId",
      "GET /",
      "POST /",
      "POST :clientId/rotate",
    ]);
  });

  it("creates a client for the authenticated owner and converts expiry", async () => {
    service.createClient.mockResolvedValue({
      client: { id: "client-1" },
      token: "once",
    });

    await controller.create(request, {
      name: "Hermes",
      scopes: ["briefs:read"],
      expiresAt: "2026-08-16T12:00:00.000Z",
    });

    expect(service.createClient).toHaveBeenCalledWith("owner-authenticated", {
      name: "Hermes",
      scopes: ["briefs:read"],
      expiresAt: new Date("2026-08-16T12:00:00.000Z"),
    });
  });

  it("lists, rotates, and revokes only for the authenticated owner", async () => {
    service.listClients.mockResolvedValue([]);
    service.rotateClient.mockResolvedValue({
      client: { id: "client-1" },
      token: "once",
    });
    service.revokeClient.mockResolvedValue(undefined);

    await expect(controller.list(request)).resolves.toEqual([]);
    await controller.rotate(request, "client-1");
    await expect(
      controller.revoke(request, "client-1")
    ).resolves.toBeUndefined();

    expect(service.listClients).toHaveBeenCalledWith("owner-authenticated");
    expect(service.rotateClient).toHaveBeenCalledWith(
      "owner-authenticated",
      "client-1"
    );
    expect(service.revokeClient).toHaveBeenCalledWith(
      "owner-authenticated",
      "client-1"
    );
  });

  it("returns no content after revocation", () => {
    expect(
      Reflect.getMetadata("__httpCode__", AgentAuthController.prototype.revoke)
    ).toBe(HttpStatus.NO_CONTENT);
  });
});

describe("AgentAuthController request security", () => {
  let app: INestApplication;
  const service = {
    createClient: jest.fn(),
    listClients: jest.fn(),
    rotateClient: jest.fn(),
    revokeClient: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AgentAuthController],
      providers: [{ provide: AgentAuthService, useValue: service }],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate(context: {
          switchToHttp(): { getRequest(): typeof request };
        }) {
          context.switchToHttp().getRequest().user = request.user;
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalPipes(createApplicationValidationPipe());
    await app.listen(0, "127.0.0.1");
  });

  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  it.each([
    { name: "Hermes", scopes: ["admin:all"] },
    { name: "Hermes", scopes: ["briefs:read", "briefs:read"] },
    {
      name: "Hermes",
      scopes: ["briefs:read"],
      ownerId: "owner-attacker",
    },
  ])(
    "rejects unsupported, duplicate, or caller-owned authority %p",
    async (body) => {
      const address = app.getHttpServer().address() as { port: number };
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/agent-clients`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      expect(response.status).toBe(400);
      expect(service.createClient).not.toHaveBeenCalled();
    }
  );
});

describe("AgentAuthModule", () => {
  it("exports the authentication service and bearer guard", () => {
    const exports = Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      AgentAuthModule
    );

    expect(exports).toEqual(
      expect.arrayContaining([AgentAuthService, AgentAuthGuard])
    );
  });
});
