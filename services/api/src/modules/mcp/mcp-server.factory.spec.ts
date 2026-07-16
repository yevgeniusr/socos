import type { AgentPrincipal } from "@socos/agent-core";
import { z } from "zod";
import type { AgentToolRegistryService } from "../agent-tools/tool-registry.service.js";
import { McpServerFactory } from "./mcp-server.factory.js";

const principal: AgentPrincipal = {
  ownerId: "owner-synthetic",
  clientId: "client-synthetic",
  credentialId: "credential-synthetic",
  clientName: "Hermes",
  scopes: ["contacts:read"],
};

function harness() {
  const inputSchema = z.strictObject({ query: z.string().min(1).max(100) });
  const registry = {
    definitions: jest.fn().mockReturnValue([
      {
        metadata: {
          name: "socos_contacts_search",
          description: "Search contacts",
          requiredScope: "contacts:read",
          risk: "read",
          requiresIdempotencyKey: false,
        },
        inputSchema,
      },
    ]),
    call: jest.fn().mockResolvedValue({ ok: true, data: { contacts: [] } }),
  };
  return {
    factory: new McpServerFactory(
      registry as unknown as AgentToolRegistryService
    ),
    inputSchema,
    registry,
  };
}

describe("McpServerFactory", () => {
  it("creates a fresh stateless JSON server and transport every time", () => {
    const { factory } = harness();

    const first = factory.create(principal);
    const second = factory.create(principal);

    expect(first.server).not.toBe(second.server);
    expect(first.transport).not.toBe(second.transport);
    expect(first.transport.sessionId).toBeUndefined();
    expect(second.transport.sessionId).toBeUndefined();
  });

  it("registers only explicit registry definitions with their exact schemas", () => {
    const { factory, inputSchema, registry } = harness();

    const runtime = factory.create(principal);

    expect(registry.definitions).toHaveBeenCalledTimes(1);
    expect(runtime.definitions).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({ name: "socos_contacts_search" }),
        inputSchema,
      }),
    ]);
  });

  it("bridges registry failures without leaking thrown details", async () => {
    const { factory, registry } = harness();
    registry.call.mockRejectedValue(new Error("private database details"));

    const result = await factory.callTool(principal, "socos_contacts_search", {
      query: "Synthetic",
    });

    expect(result).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            error: {
              code: "INTERNAL_ERROR",
              message: "Agent tool execution failed.",
              retryable: true,
            },
          }),
        },
      ],
      structuredContent: {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Agent tool execution failed.",
          retryable: true,
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("private database details");
  });
});
