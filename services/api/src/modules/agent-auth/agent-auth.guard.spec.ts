import { UnauthorizedException, type ExecutionContext } from "@nestjs/common";
import type { AgentPrincipal } from "@socos/agent-core";
import { AgentAuthGuard } from "./agent-auth.guard.js";
import type { AgentAuthService } from "./agent-auth.service.js";

const principal: AgentPrincipal = {
  ownerId: "owner-server",
  clientId: "client-server",
  clientName: "Hermes",
  credentialId: "credential-server",
  scopes: ["briefs:read"],
};

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe("AgentAuthGuard", () => {
  const service = { authenticate: jest.fn() };
  const guard = new AgentAuthGuard(service as unknown as AgentAuthService);

  beforeEach(() => jest.clearAllMocks());

  it("authenticates exactly one bearer token and attaches only the server principal", async () => {
    const request = {
      headers: { authorization: "Bearer credential-token" },
      body: { ownerId: "owner-attacker", scopes: ["approvals:execute"] },
      agent: { ownerId: "owner-attacker", scopes: ["approvals:execute"] },
    };
    service.authenticate.mockResolvedValue(principal);

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(service.authenticate).toHaveBeenCalledWith("credential-token");
    expect(request.agent).toBe(principal);
  });

  it.each([
    undefined,
    "",
    "Basic credential-token",
    "Bearer",
    "Bearer ",
    "Bearer credential-token extra",
    "Bearer credential-one,Bearer credential-two",
    ["Bearer credential-one", "Bearer credential-two"],
  ])(
    "rejects malformed or multiple authorization values %p generically",
    async (authorization) => {
      const request = { headers: { authorization } };

      await expect(
        guard.canActivate(contextFor(request))
      ).rejects.toMatchObject({
        status: 401,
        message: "Invalid or missing agent credential",
      });
      expect(service.authenticate).not.toHaveBeenCalled();
      expect(request).not.toHaveProperty("agent");
    }
  );

  it("does not expose authentication failure details", async () => {
    service.authenticate.mockRejectedValue(
      new UnauthorizedException("credential row was revoked")
    );

    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: "Bearer credential-token" } })
      )
    ).rejects.toMatchObject({
      status: 401,
      message: "Invalid or missing agent credential",
    });
  });
});
