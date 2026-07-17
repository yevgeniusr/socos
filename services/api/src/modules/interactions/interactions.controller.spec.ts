import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AuthGuard } from "../auth/auth.guard.js";
import { InteractionsController } from "./interactions.controller.js";
import { InteractionsService } from "./interactions.service.js";

describe("InteractionsController", () => {
  async function harness() {
    const interactionsService = {
      create: jest.fn(),
      delete: jest.fn().mockResolvedValue({ success: true }),
      getReceipt: jest.fn().mockResolvedValue({
        outcome: "Recorded only; nothing sent",
      }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [InteractionsController],
      providers: [
        { provide: InteractionsService, useValue: interactionsService },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate(context: {
          switchToHttp(): { getRequest(): { user?: { userId: string } } };
        }) {
          context.switchToHttp().getRequest().user = {
            userId: "owner-synthetic",
          };
          return true;
        },
      })
      .compile();
    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as { port: number };
    return {
      app,
      baseUrl: `http://127.0.0.1:${address.port}`,
      interactionsService,
    };
  }

  it("requires an idempotency key for interaction creation", async () => {
    const { app, baseUrl, interactionsService } = await harness();
    try {
      const response = await fetch(`${baseUrl}/interactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId: "contact-synthetic", type: "note" }),
      });
      expect(response.status).toBe(400);
      expect(interactionsService.create).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("gets a receipt through owner scope", async () => {
    const { app, baseUrl, interactionsService } = await harness();
    try {
      const response = await fetch(
        `${baseUrl}/interactions/interaction-synthetic/receipt`
      );
      expect(response.status).toBe(200);
      expect(interactionsService.getReceipt).toHaveBeenCalledWith(
        "owner-synthetic",
        "interaction-synthetic"
      );
    } finally {
      await app.close();
    }
  });

  it("does not register a direct interaction deletion route", async () => {
    const { app, baseUrl, interactionsService } = await harness();
    try {
      const response = await fetch(
        `${baseUrl}/interactions/interaction-synthetic`,
        { method: "DELETE" }
      );

      expect(response.status).toBe(404);
      expect(interactionsService.delete).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
