import { INestApplication, RequestMethod } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";
import { createApplicationValidationPipe } from "../../common/application-validation.pipe.js";
import { AuthGuard } from "../auth/auth.guard.js";
import { BriefFeedbackService } from "./brief-feedback.service.js";
import { BriefGeneratorService } from "./brief-generator.service.js";
import { BriefsController } from "./briefs.controller.js";

const now = new Date("2026-07-16T12:00:00.000Z");
const request = { user: { userId: "owner-authenticated" } };
const dailyBrief = {
  schemaVersion: "1.0" as const,
  briefId: "brief-synthetic",
  localDate: "2026-07-16",
  timeZone: "Asia/Dubai",
  generatedAt: now.toISOString(),
  people: [],
  dates: [],
  quests: [],
  allowedActions: ["accept", "snooze", "dismiss", "complete"] as [
    "accept",
    "snooze",
    "dismiss",
    "complete",
  ],
};

function createHarness() {
  const generator = {
    getReadyForOwner: jest.fn(),
    generateForOwner: jest.fn(),
  };
  const feedback = {
    recordItemFeedback: jest.fn(),
    completeQuest: jest.fn(),
  };
  return {
    controller: new BriefsController(
      generator as unknown as BriefGeneratorService,
      feedback as unknown as BriefFeedbackService
    ),
    feedback,
    generator,
  };
}

describe("BriefsController contract", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("publishes only the guarded Hermes brief routes with bearer metadata", () => {
    expect(Reflect.getMetadata(PATH_METADATA, BriefsController)).toBe("briefs");
    expect(Reflect.getMetadata(GUARDS_METADATA, BriefsController)).toContain(
      AuthGuard
    );
    expect(
      Reflect.getMetadata("swagger/apiSecurity", BriefsController)
    ).toEqual(expect.arrayContaining([{ bearer: [] }]));

    const routes = Object.getOwnPropertyNames(BriefsController.prototype)
      .flatMap((methodName) => {
        const handler =
          BriefsController.prototype[methodName as keyof BriefsController];
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as
          | RequestMethod
          | undefined;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as
          | string
          | undefined;
        return method === undefined || path === undefined
          ? []
          : [`${RequestMethod[method]} ${path}`];
      })
      .sort();

    expect(routes).toEqual([
      "GET today",
      "POST generate",
      "POST items/:itemId/feedback",
      "POST quests/:questId/complete",
    ]);
    expect(routes.join(" ").toLowerCase()).not.toMatch(
      /send|message|recipient|invite|introduction|merge|delete/
    );
  });

  it("reads today's ready brief for only the authenticated owner", async () => {
    const harness = createHarness();
    harness.generator.getReadyForOwner.mockResolvedValue(dailyBrief);

    await expect(harness.controller.today(request)).resolves.toEqual(
      dailyBrief
    );

    expect(harness.generator.getReadyForOwner).toHaveBeenCalledWith(
      request.user.userId,
      now
    );
    expect(harness.generator.generateForOwner).not.toHaveBeenCalled();
  });

  it("returns BRIEF_NOT_READY without generating on a read miss", async () => {
    const harness = createHarness();
    harness.generator.getReadyForOwner.mockResolvedValue(null);

    let response: unknown;
    try {
      await harness.controller.today(request);
    } catch (error) {
      response = (error as { getResponse(): unknown }).getResponse();
    }

    expect(response).toEqual({
      code: "BRIEF_NOT_READY",
      message: "Today's brief is not ready.",
    });
    expect(harness.generator.generateForOwner).not.toHaveBeenCalled();
  });

  it("generates explicitly for only the authenticated owner", async () => {
    const harness = createHarness();
    harness.generator.generateForOwner.mockResolvedValue(dailyBrief);

    await expect(harness.controller.generate(request)).resolves.toEqual(
      dailyBrief
    );

    expect(harness.generator.generateForOwner).toHaveBeenCalledWith(
      request.user.userId,
      now
    );
  });

  it("forwards item feedback with the authenticated owner and stable key", async () => {
    const harness = createHarness();
    const result = {
      feedbackId: "feedback-synthetic",
      itemId: "item-synthetic",
      action: "dismiss",
      status: "dismissed",
      reason: "Synthetic reason",
      snoozedUntil: null,
    };
    harness.feedback.recordItemFeedback.mockResolvedValue(result);

    await expect(
      harness.controller.recordItemFeedback(
        request,
        "item-synthetic",
        "intent:item-001",
        { action: "dismiss", reason: "Synthetic reason" }
      )
    ).resolves.toEqual(result);

    expect(harness.feedback.recordItemFeedback).toHaveBeenCalledWith(
      request.user.userId,
      "item-synthetic",
      "intent:item-001",
      { action: "dismiss", reason: "Synthetic reason" }
    );
  });

  it("forwards quest evidence with the authenticated owner and stable key", async () => {
    const harness = createHarness();
    const result = {
      feedbackId: "feedback-synthetic",
      questId: "quest-synthetic",
      status: "completed",
      completedAt: now,
      xpAwarded: 15,
    };
    harness.feedback.completeQuest.mockResolvedValue(result);

    await expect(
      harness.controller.completeQuest(
        request,
        "quest-synthetic",
        "intent:quest-001",
        { interactionId: "interaction-synthetic" }
      )
    ).resolves.toEqual(result);

    expect(harness.feedback.completeQuest).toHaveBeenCalledWith(
      request.user.userId,
      "quest-synthetic",
      "intent:quest-001",
      { interactionId: "interaction-synthetic" }
    );
  });

  it.each([undefined, "", "short", "contains space", "x".repeat(129)])(
    "rejects a missing or invalid item idempotency key",
    async (key) => {
      const harness = createHarness();

      expect(() =>
        harness.controller.recordItemFeedback(
          request,
          "item-synthetic",
          key as string,
          { action: "accept" }
        )
      ).toThrow(expect.objectContaining({ status: 400 }));
      expect(harness.feedback.recordItemFeedback).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, "", "short", "contains space", "x".repeat(129)])(
    "rejects a missing or invalid quest idempotency key",
    async (key) => {
      const harness = createHarness();

      expect(() =>
        harness.controller.completeQuest(
          request,
          "quest-synthetic",
          key as string,
          { interactionId: "interaction-synthetic" }
        )
      ).toThrow(expect.objectContaining({ status: 400 }));
      expect(harness.feedback.completeQuest).not.toHaveBeenCalled();
    }
  );
});

describe("BriefsController request-body security", () => {
  let app: INestApplication;
  const generator = {
    getReadyForOwner: jest.fn(),
    generateForOwner: jest.fn(),
  };
  const feedback = {
    recordItemFeedback: jest.fn(),
    completeQuest: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BriefsController],
      providers: [
        { provide: BriefGeneratorService, useValue: generator },
        { provide: BriefFeedbackService, useValue: feedback },
      ],
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

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    feedback.recordItemFeedback.mockResolvedValue({ ok: true });
    feedback.completeQuest.mockResolvedValue({ ok: true });
  });

  it("rejects identity, XP, outbound, and destructive item commands", async () => {
    const address = app.getHttpServer().address() as { port: number };
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/briefs/items/item-synthetic/feedback`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "intent:item-http-001",
        },
        body: JSON.stringify({
          action: "accept",
          ownerId: "owner-attacker",
          userId: "user-attacker",
          xpReward: 999,
          recipient: "recipient-synthetic",
          message: "outbound text",
          send: true,
          invite: true,
          introduction: true,
          merge: true,
          delete: true,
        }),
      }
    );

    expect(response.status).toBe(400);
    expect(feedback.recordItemFeedback).not.toHaveBeenCalled();
  });

  it("rejects identity, XP, outbound, and destructive quest commands", async () => {
    const address = app.getHttpServer().address() as { port: number };
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/briefs/quests/quest-synthetic/complete`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "intent:quest-http-001",
        },
        body: JSON.stringify({
          interactionId: "interaction-synthetic",
          ownerId: "owner-attacker",
          userId: "user-attacker",
          xpReward: 999,
          recipient: "recipient-synthetic",
          message: "outbound text",
          send: true,
          invite: true,
          introduction: true,
          merge: true,
          delete: true,
        }),
      }
    );

    expect(response.status).toBe(400);
    expect(feedback.completeQuest).not.toHaveBeenCalled();
  });
});
