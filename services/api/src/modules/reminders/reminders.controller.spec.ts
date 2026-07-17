import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AuthGuard } from "../auth/auth.guard.js";
import { RemindersController } from "./reminders.controller.js";
import { RemindersService } from "./reminders.service.js";

describe("RemindersController", () => {
  it("does not register a direct reminder deletion route", async () => {
    const remindersService = {
      delete: jest.fn().mockResolvedValue({ success: true }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [RemindersController],
      providers: [{ provide: RemindersService, useValue: remindersService }],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate(context: {
          switchToHttp(): { getRequest(): { user?: { userId: string } } };
        }) {
          context.switchToHttp().getRequest().user = {
            userId: "synthetic-owner",
          };
          return true;
        },
      })
      .compile();
    const app: INestApplication = moduleRef.createNestApplication();
    await app.listen(0, "127.0.0.1");

    try {
      const address = app.getHttpServer().address() as { port: number };
      const response = await fetch(
        `http://127.0.0.1:${address.port}/reminders/reminder-synthetic`,
        { method: "DELETE" }
      );

      expect(response.status).toBe(404);
      expect(remindersService.delete).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
