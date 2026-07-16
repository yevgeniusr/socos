import { validate } from "class-validator";
import { CreateAgentClientDto } from "./agent-auth.dto.js";

jest.mock("@socos/agent-core", () => ({
  AGENT_SCOPES: ["contacts:read", "approvals:execute"],
}));
const mockAgentScopes = ["contacts:read", "approvals:execute"] as const;

describe("CreateAgentClientDto", () => {
  it("accepts a bounded name, unique supported scopes, and an ISO expiry", async () => {
    const dto = Object.assign(new CreateAgentClientDto(), {
      name: "Hermes",
      scopes: [mockAgentScopes[0], mockAgentScopes[mockAgentScopes.length - 1]],
      expiresAt: "2026-08-16T12:00:00.000Z",
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it.each([
    [{ name: "", scopes: [mockAgentScopes[0]] }, "name"],
    [{ name: "   ", scopes: [mockAgentScopes[0]] }, "name"],
    [{ name: "x".repeat(81), scopes: [mockAgentScopes[0]] }, "name"],
    [{ name: "Hermes", scopes: [] }, "scopes"],
    [
      { name: "Hermes", scopes: [mockAgentScopes[0], mockAgentScopes[0]] },
      "scopes",
    ],
    [{ name: "Hermes", scopes: ["admin:all"] }, "scopes"],
    [
      { name: "Hermes", scopes: [mockAgentScopes[0]], expiresAt: "tomorrow" },
      "expiresAt",
    ],
  ])("rejects invalid client input %p", async (values, property) => {
    const errors = await validate(
      Object.assign(new CreateAgentClientDto(), values)
    );

    expect(errors.map((error) => error.property)).toContain(property);
  });
});
