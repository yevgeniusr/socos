import { Injectable } from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AgentPrincipal, AgentResult } from "@socos/agent-core";
import type { Prisma } from "@prisma/client";
import {
  AgentToolRegistryService,
  type PublicAgentToolDefinition,
} from "../agent-tools/tool-registry.service.js";

export interface McpRequestRuntime {
  readonly server: McpServer;
  readonly transport: StreamableHTTPServerTransport;
  readonly definitions: readonly PublicAgentToolDefinition[];
}

const INTERNAL_FAILURE: AgentResult<Prisma.JsonValue> = Object.freeze({
  ok: false,
  error: Object.freeze({
    code: "INTERNAL_ERROR",
    message: "Agent tool execution failed.",
    retryable: true,
  }),
});

@Injectable()
export class McpServerFactory {
  constructor(private readonly registry: AgentToolRegistryService) {}

  create(principal: AgentPrincipal): McpRequestRuntime {
    const server = new McpServer({ name: "socos", version: "1.0.0" });
    const definitions = this.registry.definitions();
    for (const definition of definitions) {
      const { metadata, inputSchema } = definition;
      server.registerTool(
        metadata.name,
        {
          description: metadata.description,
          inputSchema,
          annotations: {
            readOnlyHint: metadata.risk === "read",
            destructiveHint: false,
            idempotentHint: metadata.requiresIdempotencyKey,
            openWorldHint: false,
          },
        },
        (input) => this.callTool(principal, metadata.name, input)
      );
    }

    return {
      server,
      transport: new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      }),
      definitions,
    };
  }

  async callTool(
    principal: AgentPrincipal,
    name: string,
    input: unknown
  ): Promise<CallToolResult> {
    let result: AgentResult<Prisma.JsonValue>;
    try {
      result = await this.registry.call(name, principal, input);
    } catch {
      result = INTERNAL_FAILURE;
    }
    return bridgeResult(result);
  }
}

function bridgeResult(result: AgentResult<Prisma.JsonValue>): CallToolResult {
  return {
    ...(result.ok ? {} : { isError: true }),
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result as unknown as Record<string, unknown>,
  };
}
