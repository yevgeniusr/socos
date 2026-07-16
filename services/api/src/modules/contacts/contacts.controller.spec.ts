import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { createApplicationValidationPipe } from "../../common/application-validation.pipe.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { InteractionType } from "../interactions/interactions.dto.js";
import { InteractionsService } from "../interactions/interactions.service.js";
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
      providers: [
        { provide: ContactsService, useValue: contactsService },
        { provide: InteractionsService, useValue: {} },
      ],
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
      providers: [
        { provide: ContactsService, useValue: contactsService },
        { provide: InteractionsService, useValue: {} },
      ],
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

  it("validates contact interaction bodies and injects the route contact ID", async () => {
    const contactsService = {};
    const interactionsService = {
      create: jest.fn().mockResolvedValue({ interaction: { id: "interaction-synthetic" } }),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [ContactsController],
      providers: [
        { provide: ContactsService, useValue: contactsService },
        { provide: InteractionsService, useValue: interactionsService },
      ],
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
    app.useGlobalPipes(createApplicationValidationPipe());
    await app.listen(0, "127.0.0.1");

    try {
      const address = app.getHttpServer().address() as { port: number };
      const baseUrl = `http://127.0.0.1:${address.port}/contacts/contact-route/interactions`;
      const validResponse = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "intent-key-interaction-001",
        },
        body: JSON.stringify({
          type: InteractionType.NOTE,
          title: "Synthetic note",
        }),
      });
      const callerOwnedContactResponse = await fetch(baseUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactId: "contact-caller",
          type: InteractionType.NOTE,
        }),
      });

      expect(validResponse.status).toBe(201);
      expect(interactionsService.create).toHaveBeenCalledWith(
        "synthetic-owner",
        {
          contactId: "contact-route",
          type: InteractionType.NOTE,
          title: "Synthetic note",
        },
        "intent-key-interaction-001"
      );
      expect(callerOwnedContactResponse.status).toBe(400);
      expect(interactionsService.create).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it("delegates compatibility interaction reads to InteractionsService", async () => {
    const interactionsService = {
      findByContact: jest.fn().mockResolvedValue([]),
    };
    const controller = new ContactsController(
      {} as ContactsService,
      interactionsService as unknown as InteractionsService
    );

    await expect(
      controller.getInteractions(
        { user: { userId: "synthetic-owner" } },
        "contact-synthetic",
        12
      )
    ).resolves.toEqual([]);
    expect(interactionsService.findByContact).toHaveBeenCalledWith(
      "synthetic-owner",
      "contact-synthetic",
      12
    );
  });

  it("does not expose duplicate interaction writes on ContactsService", () => {
    const prototype = ContactsService.prototype as unknown as Record<
      string,
      unknown
    >;

    expect(prototype.createInteraction).toBeUndefined();
    expect(prototype.getInteractions).toBeUndefined();
  });
});
