import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { AgentPrincipal } from "@socos/agent-core";
import { AgentAuthService } from "./agent-auth.service.js";

interface AgentRequest {
  headers: { authorization?: unknown };
  agent?: AgentPrincipal;
}

@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(private readonly agentAuth: AgentAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AgentRequest>();
    const authorization = request.headers.authorization;
    if (typeof authorization !== "string") throw invalidCredential();

    const match = /^Bearer ([^\s,]+)$/.exec(authorization);
    if (!match) throw invalidCredential();

    try {
      request.agent = await this.agentAuth.authenticate(match[1]);
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw invalidCredential();
      throw error;
    }
  }
}

function invalidCredential(): UnauthorizedException {
  return new UnauthorizedException("Invalid or missing agent credential");
}
