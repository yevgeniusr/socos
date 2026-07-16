import { HttpException, Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  AgentErrorCode,
  AgentPrincipal,
  AgentPublicError,
  AgentResult,
  AgentToolMetadata,
} from "@socos/agent-core";
import type { z } from "zod";
import { AgentAuditService } from "../agent-security/agent-audit.service.js";
import { AgentIdempotencyService } from "../agent-security/agent-idempotency.service.js";
import { hashCanonicalJson } from "../agent-security/canonical-json.js";
import {
  AgentHandlerError,
  AgentToolHandlers,
  createExplicitAgentTools,
  type ExplicitAgentTool,
} from "./tool-handlers.js";

export interface PublicAgentToolDefinition {
  readonly metadata: AgentToolMetadata;
  readonly inputSchema: z.ZodType;
}

@Injectable()
export class AgentToolRegistryService {
  private readonly tools: readonly ExplicitAgentTool[];
  private readonly toolsByName: ReadonlyMap<string, ExplicitAgentTool>;
  private readonly publicDefinitions: readonly PublicAgentToolDefinition[];
  private readonly publicDefinitionsByName: ReadonlyMap<
    string,
    PublicAgentToolDefinition
  >;

  constructor(
    handlers: AgentToolHandlers,
    private readonly idempotency: AgentIdempotencyService,
    private readonly audit: AgentAuditService
  ) {
    this.tools = createExplicitAgentTools(handlers);
    this.toolsByName = new Map(
      this.tools.map((tool) => [tool.metadata.name, tool])
    );
    this.publicDefinitions = Object.freeze(
      this.tools.map((tool) =>
        Object.freeze({
          metadata: tool.metadata,
          inputSchema: tool.inputSchema,
        })
      )
    );
    this.publicDefinitionsByName = new Map(
      this.publicDefinitions.map((definition) => [
        definition.metadata.name,
        definition,
      ])
    );
  }

  list(): readonly AgentToolMetadata[] {
    return this.tools.map((tool) => tool.metadata);
  }

  definitions(): readonly PublicAgentToolDefinition[] {
    return this.publicDefinitions;
  }

  getDefinition(name: string): PublicAgentToolDefinition | null {
    return this.publicDefinitionsByName.get(name) ?? null;
  }

  async call(
    name: string,
    principal: AgentPrincipal,
    rawInput: unknown
  ): Promise<AgentResult<Prisma.JsonValue>> {
    const tool = this.toolsByName.get(name);
    if (!tool) return fail("NOT_FOUND", "Unknown agent tool.", false);
    if (!principal.scopes.includes(tool.metadata.requiredScope)) {
      const error = stableError(
        "INSUFFICIENT_SCOPE",
        "Agent scope is insufficient.",
        false
      );
      await this.recordPreDispatchRejection(tool, principal, error);
      return { ok: false, error };
    }

    const parsed = tool.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      const error = stableError(
        "INVALID_INPUT",
        "Agent tool input is invalid.",
        false
      );
      await this.recordPreDispatchRejection(tool, principal, error);
      return { ok: false, error };
    }
    const input = parsed.data as Prisma.JsonValue;

    if (!tool.metadata.requiresIdempotencyKey) {
      return this.invoke(tool, principal, input);
    }
    const idempotencyKey = readIdempotencyKey(input);
    if (!idempotencyKey) {
      return fail("INVALID_INPUT", "Agent tool input is invalid.", false);
    }

    try {
      let dispatched = false;
      const result = await this.idempotency.execute(
        principal,
        tool.metadata.name,
        idempotencyKey,
        input,
        async (transaction) => {
          dispatched = true;
          const data = await tool.handler(
            principal,
            input as never,
            transaction
          );
          hashCanonicalJson(data);
          const result: AgentResult<Prisma.JsonValue> = {
            ok: true,
            data: data as Prisma.JsonValue,
          };
          await this.recordSuccessAudit(
            tool,
            principal,
            input,
            idempotencyKey,
            transaction
          );
          return result;
        }
      );
      if (result.ok === false) {
        await this.recordFailureAudit(
          tool,
          principal,
          input,
          idempotencyKey,
          result.error
        );
      } else if (!dispatched) {
        await this.recordReplayAudit(
          tool,
          principal,
          input,
          idempotencyKey
        );
      }
      return result;
    } catch (error) {
      const mapped = publicError(error);
      await this.recordFailureAudit(
        tool,
        principal,
        input,
        idempotencyKey,
        mapped
      );
      return { ok: false, error: mapped };
    }
  }

  private async invoke(
    tool: ExplicitAgentTool,
    principal: AgentPrincipal,
    input: Prisma.JsonValue,
    transaction?: Prisma.TransactionClient
  ): Promise<AgentResult<Prisma.JsonValue>> {
    try {
      const data = await tool.handler(principal, input as never, transaction);
      hashCanonicalJson(data);
      return { ok: true, data: data as Prisma.JsonValue };
    } catch (error) {
      return { ok: false, error: publicError(error) };
    }
  }

  private recordSuccessAudit(
    tool: ExplicitAgentTool,
    principal: AgentPrincipal,
    input: Prisma.JsonValue,
    idempotencyKey: string,
    transaction: Prisma.TransactionClient
  ) {
    return this.audit.record(
      principal,
      {
        operation: tool.metadata.name,
        ...(isActionTool(tool.metadata.name)
          ? { actionType: readActionType(input) }
          : {}),
        outcome: "succeeded",
        requestHash: hashCanonicalJson(input),
        idempotencyKey,
        metadata: { riskLevel: tool.metadata.risk, replayed: false },
      },
      transaction
    );
  }

  private async recordReplayAudit(
    tool: ExplicitAgentTool,
    principal: AgentPrincipal,
    input: Prisma.JsonValue,
    idempotencyKey: string
  ): Promise<void> {
    try {
      await this.audit.record(principal, {
        operation: tool.metadata.name,
        ...(isActionTool(tool.metadata.name)
          ? { actionType: readActionType(input) }
          : {}),
        outcome: "succeeded",
        requestHash: hashCanonicalJson(input),
        idempotencyKey,
        metadata: { riskLevel: tool.metadata.risk, replayed: true },
      });
    } catch {
      // A replay has no new side effect; audit persistence failure stays private.
    }
  }

  private async recordPreDispatchRejection(
    tool: ExplicitAgentTool,
    principal: AgentPrincipal,
    error: AgentPublicError
  ): Promise<void> {
    if (tool.metadata.risk === "read") return;
    try {
      await this.audit.record(principal, {
        operation: tool.metadata.name,
        outcome: "rejected",
        metadata: { errorCode: error.code, riskLevel: tool.metadata.risk },
      });
    } catch {
      // Authorization and validation failures must retain their stable response.
    }
  }

  private async recordFailureAudit(
    tool: ExplicitAgentTool,
    principal: AgentPrincipal,
    input: Prisma.JsonValue,
    idempotencyKey: string,
    error: AgentPublicError
  ): Promise<void> {
    try {
      await this.audit.record(principal, {
        operation: tool.metadata.name,
        ...(isActionTool(tool.metadata.name)
          ? { actionType: readActionType(input) }
          : {}),
        outcome:
          error.code === "NOT_FOUND" ||
          error.code === "CONFLICT" ||
          error.code === "INVALID_INPUT"
            ? "rejected"
            : "failed",
        requestHash: hashCanonicalJson(input),
        idempotencyKey,
        metadata: { errorCode: error.code, riskLevel: tool.metadata.risk },
      });
    } catch {
      // The original transaction has already rolled back; audit failure is private.
    }
  }
}

function readIdempotencyKey(input: Prisma.JsonValue): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = (input as Prisma.JsonObject).idempotencyKey;
  return typeof value === "string" ? value : null;
}

function readActionType(input: Prisma.JsonValue) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return undefined;
  return (input as Prisma.JsonObject).actionType as
    | "message"
    | "introduction"
    | "invitation"
    | "merge"
    | "delete";
}

function isActionTool(name: string): boolean {
  return (
    name === "socos_propose_action" ||
    name === "socos_execute_approved_action"
  );
}

function publicError(error: unknown): AgentPublicError {
  if (error instanceof AgentHandlerError) return error.publicError;
  if (error instanceof HttpException) {
    const status = error.getStatus();
    if (status === 400 || status === 422) {
      return stableError(
        "INVALID_INPUT",
        "Agent tool input is invalid.",
        false
      );
    }
    if (status === 404) {
      return stableError(
        "NOT_FOUND",
        "Requested resource was not found.",
        false
      );
    }
    if (status === 409) {
      return stableError(
        "CONFLICT",
        "The request conflicts with current state.",
        false
      );
    }
  }
  return stableError("INTERNAL_ERROR", "Agent tool execution failed.", true);
}

function stableError(
  code: AgentErrorCode,
  message: string,
  retryable: boolean
): AgentPublicError {
  return { code, message, retryable };
}

function fail<T extends Prisma.JsonValue>(
  code: AgentErrorCode,
  message: string,
  retryable: boolean
): AgentResult<T> {
  return { ok: false, error: stableError(code, message, retryable) };
}
