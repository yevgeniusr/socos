import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createApplicationValidationPipe } from "../../common/application-validation.pipe.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { EventCatalogService } from "./event-catalog.service.js";
import { EventCatalogController } from "./events.controller.js";

describe("event catalog follow HTTP contract", () => {
  let app: INestApplication;
  let endpoint: string;
  const catalog = {
    putFollow: jest.fn().mockResolvedValue({
      slug: "uae-public-holidays",
      followed: true,
      follow: { status: "active", socialWeight: 5 },
    }),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [EventCatalogController],
      providers: [
        { provide: EventCatalogService, useValue: catalog },
        { provide: AuthGuard, useValue: { canActivate: () => true } },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate(context: {
          switchToHttp(): { getRequest(): { user?: { userId: string } } };
        }) {
          context.switchToHttp().getRequest().user = { userId: "owner-http" };
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalPipes(createApplicationValidationPipe());
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    endpoint = `http://127.0.0.1:${address.port}/api/event-catalog/uae-public-holidays/follow`;
  });

  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ["string", '"unexpected"'],
    ["number", "42"],
    ["null", "null"],
    ["array", "[]"],
  ])("rejects a root JSON %s before service work", async (_label, body) => {
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
    });

    expect(response.status).toBe(400);
    expect(catalog.putFollow).not.toHaveBeenCalled();
  });

  it("accepts an empty JSON object", async () => {
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(200);
    expect(catalog.putFollow).toHaveBeenCalledWith(
      "owner-http",
      "uae-public-holidays",
      {}
    );
  });
});
