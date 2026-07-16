import * as Sentry from "@sentry/node";
import {
  ArgumentsHost,
  type ExecutionContext,
  NotFoundException,
} from "@nestjs/common";
import { AgentAuthGuard } from "../../modules/agent-auth/agent-auth.guard.js";
import type { AgentAuthService } from "../../modules/agent-auth/agent-auth.service.js";
import { AllExceptionsFilter } from "./http-exception.filter.js";

jest.mock("@sentry/node", () => ({ captureException: jest.fn() }));

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

  it("redacts credential-bearing headers when unexpected agent authentication fails", async () => {
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
    capture.mockClear();
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status: () => ({ json }) }),
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;

    new AllExceptionsFilter().catch(failure, host);

    expect(capture).toHaveBeenCalledTimes(1);
    const sentryContext = capture.mock.calls[0][1];
    const serialized = JSON.stringify(sentryContext);
    for (const secret of Object.values(secrets)) {
      expect(serialized).not.toContain(secret);
    }
    expect(sentryContext).toEqual(
      expect.objectContaining({
        contexts: {
          request: expect.objectContaining({
            url: "/api/mcp",
            headers: {
              authorization: "[REDACTED]",
              cookie: "[REDACTED]",
              "set-cookie": "[REDACTED]",
              "proxy-authorization": "[REDACTED]",
              "x-api-key": "[REDACTED]",
              "x-auth-token": "[REDACTED]",
              "x-custom-secret": "[REDACTED]",
              host: "mcp.example.com",
            },
          }),
        },
      })
    );
    expect(request.headers.authorization).toBe(secrets.authorization);
  });
});
