import * as Sentry from "@sentry/node";
import { NotFoundException } from "@nestjs/common";
import type { ArgumentsHost, ExecutionContext } from "@nestjs/common";
import { AgentAuthGuard } from "../../modules/agent-auth/agent-auth.guard.js";
import type { AgentAuthService } from "../../modules/agent-auth/agent-auth.service.js";
import { AllExceptionsFilter } from "./http-exception.filter.js";
import { toSafeProviderError } from "../safe-provider-error.js";

const sentryIsolationScope = {
  clear: jest.fn(),
};
const sentryCurrentScope = {
  clear: jest.fn(),
  addEventProcessor: jest.fn(),
  setContext: jest.fn(),
  setTag: jest.fn(),
};

jest.mock("@sentry/node", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
  withIsolationScope: jest.fn(
    (callback: (scope: typeof sentryIsolationScope) => void) =>
      callback(sentryIsolationScope)
  ),
  withScope: jest.fn((callback: (scope: typeof sentryCurrentScope) => void) =>
    callback(sentryCurrentScope)
  ),
}));

describe("AllExceptionsFilter", () => {
  it("preserves a structured public error code for agent clients", () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          method: "GET",
          url: "/api/briefs/today",
          headers: {},
        }),
      }),
    } as unknown as ArgumentsHost;

    new AllExceptionsFilter().catch(
      new NotFoundException({
        code: "BRIEF_NOT_READY",
        message: "Today's brief is not ready.",
      }),
      host
    );

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        code: "BRIEF_NOT_READY",
        message: "Today's brief is not ready.",
        path: "/api/briefs/today",
      })
    );
  });

  it("does not reflect non-string code values", () => {
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: () => ({ json }) }),
        getRequest: () => ({ method: "GET", url: "/api/test", headers: {} }),
      }),
    } as unknown as ArgumentsHost;

    new AllExceptionsFilter().catch(
      new NotFoundException({ code: { private: true }, message: "Missing" }),
      host
    );

    expect(json.mock.calls[0][0]).not.toHaveProperty("code");
  });

  it("reports unexpected agent authentication failures with fixed safe telemetry only", async () => {
    const secrets = {
      authorization: "Bearer socos_agent_credential.private-secret",
      cookie: "session=private-session",
      setCookie: "refresh=private-refresh",
      proxyAuthorization: "Basic private-proxy-secret",
      apiKey: "private-api-key",
      authToken: "private-auth-token",
      customSecret: "private-custom-secret",
      oauthCode: "private-oauth-code",
    };
    const request = {
      method: "POST",
      url: `/api/mcp?code=${secrets.oauthCode}#private-fragment`,
      path: "/api/mcp",
      headers: {
        authorization: secrets.authorization,
        cookie: secrets.cookie,
        "set-cookie": [secrets.setCookie],
        "proxy-authorization": secrets.proxyAuthorization,
        "x-api-key": secrets.apiKey,
        "x-auth-token": secrets.authToken,
        "x-custom-secret": secrets.customSecret,
        host: "mcp.example.com",
      },
    };
    const guard = new AgentAuthGuard({
      authenticate: jest
        .fn()
        .mockRejectedValue(
          new Error("Synthetic authentication storage failure")
        ),
    } as unknown as AgentAuthService);
    const executionContext = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    let failure: unknown;
    try {
      await guard.canActivate(executionContext);
    } catch (error) {
      failure = error;
    }

    const capture = jest.mocked(Sentry.captureException);
    const captureMessage = jest.mocked(Sentry.captureMessage);
    capture.mockClear();
    captureMessage.mockClear();
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: () => ({ json }) }),
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;

    new AllExceptionsFilter().catch(failure, host);

    expect(capture).not.toHaveBeenCalled();
    expect(captureMessage).toHaveBeenCalledWith("internal_error", {
      contexts: { request: { method: "POST", url: "/api/mcp" } },
    });
    const sentryContext = captureMessage.mock.calls[0][1];
    const serialized = JSON.stringify(sentryContext);
    for (const secret of Object.values(secrets)) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain("Synthetic authentication storage failure");
    expect(request.headers.authorization).toBe(secrets.authorization);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        code: "internal_error",
        message: "Internal server error",
      })
    );
  });

  it("reports provider failures with an isolated sanitized request and no original exception", () => {
    const providerFailure = Object.assign(
      new Error("synthetic-sensitive-provider-message"),
      {
        config: { authorization: "synthetic-sensitive-provider-config" },
        response: { data: "synthetic-sensitive-provider-response" },
      }
    );
    const safeFailure = toSafeProviderError(
      "google_rate_limited",
      providerFailure
    );
    const request = {
      method: "POST",
      path: "/api/integrations/google-calendar/connect",
      url: "/api/integrations/google-calendar/connect?code=synthetic-sensitive-query",
      originalUrl:
        "/api/integrations/google-calendar/connect?code=synthetic-sensitive-query",
      headers: {
        authorization: "Bearer synthetic-sensitive-token",
        referer:
          "https://example.test/callback?code=synthetic-sensitive-referer-code",
        "x-original-url":
          "/api/events?feed=synthetic-sensitive-private-ics-url",
        "x-forwarded-uri":
          "/api/integrations/google-calendar/callback?state=synthetic-sensitive-forwarded-state",
        "arbitrary-header": "synthetic-sensitive-arbitrary-header",
      },
      body: { code: "synthetic-sensitive-body" },
      query: { code: "synthetic-sensitive-query" },
    };
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: () => ({ json }) }),
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;
    const capture = jest.mocked(Sentry.captureException);
    const captureMessage = jest.mocked(Sentry.captureMessage);
    capture.mockClear();
    captureMessage.mockClear();
    sentryIsolationScope.clear.mockClear();
    sentryCurrentScope.clear.mockClear();
    sentryCurrentScope.addEventProcessor.mockClear();
    sentryCurrentScope.setContext.mockClear();
    sentryCurrentScope.setTag.mockClear();

    new AllExceptionsFilter().catch(safeFailure, host);

    expect(capture).not.toHaveBeenCalled();
    expect(captureMessage).toHaveBeenCalledWith("safe_provider_error");
    expect(sentryIsolationScope.clear).toHaveBeenCalledTimes(1);
    expect(sentryCurrentScope.clear).toHaveBeenCalledTimes(1);
    expect(sentryCurrentScope.addEventProcessor).toHaveBeenCalledTimes(1);
    const sanitizeEvent = sentryCurrentScope.addEventProcessor.mock.calls[0][0];
    const processedEvent = sanitizeEvent({
      request: {
        data: "synthetic-sensitive-body",
        query_string: "code=synthetic-sensitive-query",
      },
    });
    expect(processedEvent).toEqual({
      request: {
        method: "POST",
        url: "/api/integrations/google-calendar/connect",
      },
    });
    expect(sentryCurrentScope.setContext).toHaveBeenCalledWith("request", {
      method: "POST",
      url: "/api/integrations/google-calendar/connect",
    });
    expect(sentryCurrentScope.setTag).toHaveBeenCalledWith(
      "safe_error_code",
      "google_rate_limited"
    );
    const sentryPayload = JSON.stringify({
      message: captureMessage.mock.calls[0][0],
      processedEvent,
      context: sentryCurrentScope.setContext.mock.calls[0][1],
      tag: sentryCurrentScope.setTag.mock.calls[0],
    });
    for (const secret of [
      "synthetic-sensitive-provider-message",
      "synthetic-sensitive-provider-config",
      "synthetic-sensitive-provider-response",
      "synthetic-sensitive-token",
      "synthetic-sensitive-body",
      "synthetic-sensitive-query",
      "synthetic-sensitive-referer-code",
      "synthetic-sensitive-private-ics-url",
      "synthetic-sensitive-forwarded-state",
      "synthetic-sensitive-arbitrary-header",
    ]) {
      expect(sentryPayload).not.toContain(secret);
    }
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 502,
        code: "google_rate_limited",
        message: "External provider request failed",
        path: "/api/integrations/google-calendar/connect",
      })
    );
  });
});
