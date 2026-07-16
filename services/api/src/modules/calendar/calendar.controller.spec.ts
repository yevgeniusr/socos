import { ServiceUnavailableException } from "@nestjs/common";
import { GUARDS_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import type { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { createApplicationValidationPipe } from "../../common/application-validation.pipe.js";
import { AuthGuard } from "../auth/auth.guard.js";
import type { PersonalDataCipherService } from "../personal-data/personal-data-cipher.service.js";
import { PersonalDataConfigService } from "../personal-data/personal-data-config.js";
import type { PersonalDataIndexService } from "../personal-data/personal-data-index.service.js";
import {
  CalendarConnectionController,
  GoogleCalendarCallbackController,
  GoogleCalendarWebhookController,
} from "./calendar.controller.js";
import {
  ConnectCalendarDto,
  parseGoogleOAuthCallbackQuery,
} from "./calendar.dto.js";
import type { CalendarConnectionService } from "./calendar-connection.service.js";

function response() {
  const value = {
    setHeader: jest.fn(),
    redirect: jest.fn(),
  };
  return value;
}

function harness(calendarFlag: unknown = "true") {
  const connections = {
    connect: jest.fn().mockResolvedValue({
      authorizationUrl: "https://accounts.google.test/auth",
    }),
    summary: jest.fn(),
    disconnect: jest.fn(),
    listSources: jest.fn(),
    updateSource: jest.fn(),
    handleCallback: jest.fn().mockResolvedValue("connected"),
    callbackResultUrl: jest
      .fn()
      .mockReturnValue(
        "https://socos.example.test/settings?calendar=old&keep=1"
      ),
  };
  const config = new PersonalDataConfigService(
    {
      get: jest.fn((name: string) =>
        name === "CALENDAR_SYNC_ENABLED" ? calendarFlag : undefined
      ),
    } as unknown as ConfigService,
    {} as PersonalDataCipherService,
    {} as PersonalDataIndexService
  );
  jest.spyOn(config, "requireEnabled");
  return {
    connections,
    config,
    human: new CalendarConnectionController(
      connections as unknown as CalendarConnectionService
    ),
    callback: new GoogleCalendarCallbackController(
      connections as unknown as CalendarConnectionService,
      config
    ),
    webhook: new GoogleCalendarWebhookController(
      {
        handleWebhook: jest.fn().mockResolvedValue("accepted"),
      } as never,
      config
    ),
  };
}

describe("calendar controller boundaries", () => {
  it("exposes the fixed production Google callback path", () => {
    expect(
      Reflect.getMetadata(PATH_METADATA, GoogleCalendarCallbackController)
    ).toBe("integrations/google-calendar");
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        GoogleCalendarCallbackController.prototype.callback
      )
    ).toBe("callback");
    expect(
      Reflect.getMetadata(PATH_METADATA, CalendarConnectionController)
    ).toBe("integrations/google-calendar");
    expect(
      Reflect.getMetadata(PATH_METADATA, GoogleCalendarWebhookController)
    ).toBe("integrations/google-calendar");
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        GoogleCalendarWebhookController.prototype.webhook
      )
    ).toBe("webhook");
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        CalendarConnectionController.prototype.connect
      )
    ).toBe("connect");
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        CalendarConnectionController.prototype.summary
      )
    ).toBe("/");
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        CalendarConnectionController.prototype.disconnect
      )
    ).toBe("/");
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        CalendarConnectionController.prototype.updateSource
      )
    ).toBe("calendars/:sourceId");
  });

  it("guards every human connection endpoint with AuthGuard", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      CalendarConnectionController
    ) as unknown[];
    expect(guards).toContain(AuthGuard);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, GoogleCalendarCallbackController)
    ).toBeUndefined();
  });

  it("derives the owner only from the authenticated request", async () => {
    const { human, connections } = harness();

    await human.connect(
      { user: { userId: "owner-authenticated" } },
      new ConnectCalendarDto()
    );

    expect(connections.connect).toHaveBeenCalledWith("owner-authenticated");
  });

  it("uses the authenticated owner for idempotent disconnect", async () => {
    const { human, connections } = harness();

    await human.disconnect({ user: { userId: "owner-authenticated" } });

    expect(connections.disconnect).toHaveBeenCalledWith("owner-authenticated");
  });

  it("rejects caller-controlled connect authority through the empty request contract", async () => {
    const pipe = createApplicationValidationPipe();

    await expect(
      pipe.transform(
        { ownerId: "owner-injected", redirect_uri: "https://attacker.test" },
        { type: "body", metatype: ConnectCalendarDto }
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects even the DTO sentinel when a caller supplies it", async () => {
    const pipe = createApplicationValidationPipe();

    await expect(
      pipe.transform(
        { _requestContract: null },
        { type: "body", metatype: ConnectCalendarDto }
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    [{ state: "state", code: ["one", "two"] }, "duplicate code"],
    [{ state: ["one", "two"], code: "code" }, "duplicate state"],
    [{ state: "state", code: "code", error: "denied" }, "code and error"],
    [{ state: "state", code: "code", ownerId: "injected" }, "extra owner"],
    [
      { state: "state", code: "code", redirect_uri: "https://attacker.test" },
      "redirect injection",
    ],
    [{ state: "state" }, "missing outcome"],
  ])("rejects %s query input before provider work", (query, _label) => {
    expect(() => parseGoogleOAuthCallbackQuery(query)).toThrow(
      "Invalid OAuth callback"
    );
  });

  it("accepts exactly one scalar code or provider error", () => {
    expect(
      parseGoogleOAuthCallbackQuery({ state: "state", code: "code" })
    ).toEqual({ state: "state", code: "code" });
    expect(
      parseGoogleOAuthCallbackQuery({ state: "state", error: "access_denied" })
    ).toEqual({ state: "state", error: "access_denied" });
  });

  it("returns a fixed no-store 303 success redirect with exactly one calendar value", async () => {
    const { callback, connections, config } = harness();
    const res = response();

    await callback.callback(
      { query: { state: "synthetic-state", code: "synthetic-code" } },
      res as unknown as Response
    );

    expect(config.requireEnabled).toHaveBeenCalledWith("calendarSync");
    expect(connections.handleCallback).toHaveBeenCalledWith({
      state: "synthetic-state",
      code: "synthetic-code",
    });
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.redirect).toHaveBeenCalledWith(
      303,
      "https://socos.example.test/settings?calendar=connected&keep=1"
    );
  });

  it.each([
    ["parser failure", { state: "state", code: "code", extra: "bad" }],
    ["provider failure", { state: "state", code: "code" }],
  ])("converts %s to the same fixed error redirect", async (label, query) => {
    const { callback, connections } = harness();
    if (label === "provider failure") {
      connections.handleCallback.mockRejectedValue(
        new Error("synthetic-sensitive-provider-body")
      );
    }
    const res = response();

    await callback.callback({ query }, res as unknown as Response);

    expect(res.redirect).toHaveBeenCalledWith(
      303,
      "https://socos.example.test/settings?calendar=error&keep=1"
    );
    if (label === "parser failure") {
      expect(connections.handleCallback).not.toHaveBeenCalled();
    }
  });

  it("consumes a valid provider denial before returning the fixed error redirect", async () => {
    const { callback, connections } = harness();
    connections.handleCallback.mockResolvedValue("error");
    const res = response();

    await callback.callback(
      { query: { state: "synthetic-state", error: "access_denied" } },
      res as unknown as Response
    );

    expect(connections.handleCallback).toHaveBeenCalledWith({
      state: "synthetic-state",
      error: "access_denied",
    });
    expect(res.redirect).toHaveBeenCalledWith(
      303,
      "https://socos.example.test/settings?calendar=error&keep=1"
    );
  });

  it("returns sanitized 503 when no configured redirect boundary exists", async () => {
    const { callback, connections } = harness();
    connections.callbackResultUrl.mockImplementation(() => {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: "integration_not_configured",
        message: "Integration is not configured",
      });
    });
    const res = response();

    const pending = callback.callback(
      {
        query: { state: "synthetic-sensitive-state", code: "synthetic-code" },
      },
      res as unknown as Response
    );

    await expect(pending).rejects.toMatchObject({ status: 503 });
    await expect(pending).rejects.toMatchObject({
      response: {
        statusCode: 503,
        code: "integration_not_configured",
        message: "Integration is not configured",
      },
    });
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    expect(res.redirect).not.toHaveBeenCalled();
    expect(connections.handleCallback).not.toHaveBeenCalled();
  });

  it.each(["false", "TRUE", "1", "yes", " true "])(
    "returns sanitized 503 without callback work for calendar flag %p",
    async (calendarFlag) => {
      const { callback, connections } = harness(calendarFlag);
      const res = response();

      const pending = callback.callback(
        { query: { state: "synthetic-state", code: "synthetic-code" } },
        res as unknown as Response
      );

      await expect(pending).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
      expect(res.redirect).not.toHaveBeenCalled();
      expect(connections.callbackResultUrl).not.toHaveBeenCalled();
      expect(connections.handleCallback).not.toHaveBeenCalled();
    }
  );
});
