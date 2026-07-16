import {
  ForbiddenException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from "@nestjs/common";
import type { Request } from "express";
import { McpRequestPolicy } from "./mcp-request-policy.js";

function request(headers: Record<string, unknown>): Request {
  return { headers } as unknown as Request;
}

describe("McpRequestPolicy", () => {
  const policy = new McpRequestPolicy();

  beforeEach(() => {
    process.env.NODE_ENV = "production";
    process.env.MCP_ALLOWED_HOSTS = "mcp.example.com";
    process.env.MCP_ALLOWED_ORIGINS = "https://mcp.example.com";
    delete process.env.MCP_TRUST_PROXY;
    delete process.env.MCP_REQUEST_TIMEOUT_MS;
  });

  it("accepts configured Coolify-facing host and origin with JSON content", () => {
    expect(() =>
      policy.assert(
        request({
          host: "mcp.example.com",
          origin: "https://mcp.example.com",
          "content-type": "application/json; charset=utf-8",
          "content-length": "32",
        }),
        { jsonrpc: "2.0", method: "ping" }
      )
    ).not.toThrow();
  });

  it("uses one trusted forwarded host behind Coolify only when configured", () => {
    process.env.MCP_TRUST_PROXY = "true";

    expect(() =>
      policy.assert(
        request({
          host: "api:3001",
          "x-forwarded-host": "mcp.example.com",
          origin: "https://mcp.example.com",
          "content-type": "application/json",
        }),
        {}
      )
    ).not.toThrow();
  });

  it("does not let same-host HTTP bypass an explicit HTTPS origin policy", () => {
    expect(() =>
      policy.assert(
        request({
          host: "mcp.example.com",
          origin: "http://mcp.example.com",
          "content-type": "application/json",
        }),
        {}
      )
    ).toThrow(ForbiddenException);
  });

  it.each([
    [
      { host: "evil.example", "content-type": "application/json" },
      ForbiddenException,
    ],
    [
      {
        host: "mcp.example.com",
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      ForbiddenException,
    ],
    [
      { host: "mcp.example.com", "content-type": "text/plain" },
      UnsupportedMediaTypeException,
    ],
    [
      {
        host: "mcp.example.com",
        "content-type": "application/json",
        "content-length": String(64 * 1024 + 1),
      },
      PayloadTooLargeException,
    ],
  ])("rejects unsafe request headers %p", (headers, ErrorType) => {
    expect(() => policy.assert(request(headers), {})).toThrow(ErrorType);
  });

  it("rejects an oversized parsed JSON body without relying on content-length", () => {
    expect(() =>
      policy.assert(
        request({
          host: "mcp.example.com",
          "content-type": "application/json",
        }),
        { value: "x".repeat(64 * 1024) }
      )
    ).toThrow(PayloadTooLargeException);
  });

  it("bounds configurable request timeouts", () => {
    process.env.MCP_REQUEST_TIMEOUT_MS = "250";
    expect(policy.timeoutMs()).toBe(250);

    process.env.MCP_REQUEST_TIMEOUT_MS = "999999";
    expect(policy.timeoutMs()).toBe(10_000);
  });
});
