import {
  All,
  Body,
  Controller,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { AgentPrincipal } from "@socos/agent-core";
import type { Request, Response } from "express";
import { AgentAuthGuard } from "../agent-auth/agent-auth.guard.js";
import { McpRequestPolicy } from "./mcp-request-policy.js";
import { McpServerFactory } from "./mcp-server.factory.js";

type AgentRequest = Request & { agent: AgentPrincipal };

@Controller("mcp")
@UseGuards(AgentAuthGuard)
export class McpController {
  constructor(
    private readonly factory: McpServerFactory,
    private readonly policy: McpRequestPolicy
  ) {}

  @Post()
  async post(
    @Req() request: AgentRequest,
    @Res() response: Response,
    @Body() body: unknown
  ): Promise<void> {
    this.policy.assert(request, body);
    const { server, transport } = this.factory.create(request.agent);
    let active = true;
    try {
      await withTimeout(
        (async () => {
          await server.connect(transport);
          if (!active) return;
          await transport.handleRequest(request, response, body);
        })(),
        this.policy.timeoutMs()
      );
    } catch (error) {
      if (!response.headersSent) {
        sendProtocolError(
          response,
          error instanceof McpTimeoutError ? 504 : 500,
          error instanceof McpTimeoutError
            ? "MCP request timed out."
            : "Internal server error."
        );
      }
    } finally {
      active = false;
      await Promise.allSettled([transport.close(), server.close()]);
    }
  }

  @All()
  unsupported(@Res() response: Response): void {
    response.setHeader("Allow", "POST");
    sendProtocolError(response, 405, "Method not allowed.");
  }
}

function sendProtocolError(
  response: Response,
  status: number,
  message: string
): void {
  response.status(status).json({
    jsonrpc: "2.0",
    error: { code: status === 500 ? -32603 : -32000, message },
    id: null,
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new McpTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

class McpTimeoutError extends Error {}
