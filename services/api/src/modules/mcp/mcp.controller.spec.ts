import type { Request, Response } from "express";
import type { AgentPrincipal } from "@socos/agent-core";
import { McpController } from "./mcp.controller.js";
import type { McpRequestPolicy } from "./mcp-request-policy.js";
import type { McpServerFactory } from "./mcp-server.factory.js";

const principal: AgentPrincipal = {
  ownerId: "owner-synthetic",
  clientId: "client-synthetic",
  credentialId: "credential-synthetic",
  clientName: "Hermes",
  scopes: ["contacts:read"],
};

function response() {
  const res = {
    headersSent: false,
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

describe("McpController lifecycle", () => {
  it("closes both per-request resources when transport handling fails", async () => {
    const transport = {
      handleRequest: jest.fn().mockRejectedValue(new Error("transport failed")),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const server = {
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const factory = {
      create: jest.fn().mockReturnValue({ transport, server }),
    };
    const policy = {
      assert: jest.fn(),
      timeoutMs: jest.fn().mockReturnValue(1000),
    };
    const controller = new McpController(
      factory as unknown as McpServerFactory,
      policy as unknown as McpRequestPolicy
    );
    const req = { agent: principal } as Request & { agent: AgentPrincipal };
    const res = response();

    await controller.post(req, res as unknown as Response, {});

    expect(server.connect).toHaveBeenCalledWith(transport);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
  });

  it("returns a bounded timeout response and closes resources", async () => {
    jest.useFakeTimers();
    const transport = {
      handleRequest: jest.fn().mockReturnValue(new Promise(() => undefined)),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const server = {
      connect: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const factory = {
      create: jest.fn().mockReturnValue({ transport, server }),
    };
    const policy = {
      assert: jest.fn(),
      timeoutMs: jest.fn().mockReturnValue(25),
    };
    const controller = new McpController(
      factory as unknown as McpServerFactory,
      policy as unknown as McpRequestPolicy
    );
    const res = response();

    const pending = controller.post(
      { agent: principal } as Request & { agent: AgentPrincipal },
      res as unknown as Response,
      {}
    );
    await jest.advanceTimersByTimeAsync(25);
    await pending;

    expect(res.status).toHaveBeenCalledWith(504);
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("includes server connection in the request timeout", async () => {
    const transport = {
      handleRequest: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const server = {
      connect: jest
        .fn()
        .mockImplementation(
          () => new Promise((resolve) => setTimeout(resolve, 75))
        ),
      close: jest.fn().mockResolvedValue(undefined),
    };
    const factory = {
      create: jest.fn().mockReturnValue({ transport, server }),
    };
    const policy = {
      assert: jest.fn(),
      timeoutMs: jest.fn().mockReturnValue(25),
    };
    const controller = new McpController(
      factory as unknown as McpServerFactory,
      policy as unknown as McpRequestPolicy
    );
    const res = response();

    await controller.post(
      { agent: principal } as Request & { agent: AgentPrincipal },
      res as unknown as Response,
      {}
    );

    expect(res.status).toHaveBeenCalledWith(504);
    expect(transport.handleRequest).not.toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
  });
});
