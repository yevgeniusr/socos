import { Module } from "@nestjs/common";
import { AgentAuthModule } from "../agent-auth/agent-auth.module.js";
import { AgentToolsModule } from "../agent-tools/agent-tools.module.js";
import { McpController } from "./mcp.controller.js";
import { McpRequestPolicy } from "./mcp-request-policy.js";
import { McpServerFactory } from "./mcp-server.factory.js";

@Module({
  imports: [AgentAuthModule, AgentToolsModule],
  controllers: [McpController],
  providers: [McpRequestPolicy, McpServerFactory],
})
export class McpModule {}
