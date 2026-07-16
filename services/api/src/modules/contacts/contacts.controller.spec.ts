import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { AuthGuard } from "../auth/auth.guard.js";
import { ContactsController } from "./contacts.controller.js";
import { ContactsService } from "./contacts.service.js";

describe("ContactsController route ordering", () => {
  it("dispatches GET /contacts/due to getDueContacts", async () => {
    const contactsService = {
      getDueContacts: jest.fn().mockResolvedValue([{ id: "contact-due" }]),
      findOne: jest.fn().mockResolvedValue({ id: "due" }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [ContactsController],
      providers: [{ provide: ContactsService, useValue: contactsService }],
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
        `http://127.0.0.1:${address.port}/contacts/due`
      );

      expect(response.status).toBe(200);
      expect(contactsService.getDueContacts).toHaveBeenCalledWith(
        "synthetic-owner",
        undefined,
        undefined
      );
      expect(contactsService.findOne).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("dispatches GET /contacts/groups to getGroups", async () => {
    const contactsService = {
      getGroups: jest.fn().mockResolvedValue(["Synthetic Group"]),
      findOne: jest.fn().mockResolvedValue({ id: "groups" }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [ContactsController],
      providers: [{ provide: ContactsService, useValue: contactsService }],
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
        `http://127.0.0.1:${address.port}/contacts/groups`
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(["Synthetic Group"]);
      expect(contactsService.getGroups).toHaveBeenCalledWith("synthetic-owner");
      expect(contactsService.findOne).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
