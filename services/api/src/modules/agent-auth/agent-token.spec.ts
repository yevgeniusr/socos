import {
  issueAgentToken,
  parseAgentToken,
  verifyAgentTokenSecret,
} from "./agent-token.js";

describe("agent credentials", () => {
  it("issues a one-time high-entropy token with only a secret hash for storage", () => {
    const issued = issueAgentToken("credentialSynthetic01");

    expect(issued.token).toMatch(
      /^socos_agent_credentialSynthetic01\.[A-Za-z0-9_-]{43}$/
    );
    expect(issued.secretHash).toMatch(/^[a-f0-9]{64}$/);
    expect(issued.secretHash).not.toContain(issued.token);
    expect(parseAgentToken(issued.token)).toEqual({
      credentialId: "credentialSynthetic01",
      secret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
  });

  it("issues different secrets for the same credential identifier", () => {
    expect(issueAgentToken("credentialSynthetic01").token).not.toBe(
      issueAgentToken("credentialSynthetic01").token
    );
  });

  it.each([
    "",
    "Bearer token",
    "socos_agent_short.secret",
    "socos_agent_credentialSynthetic01.short",
    "socos_agent_credentialSynthetic01.secret.with.dot",
    "other_credentialSynthetic01.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  ])("rejects malformed token %p", (token) => {
    expect(parseAgentToken(token)).toBeNull();
  });

  it("compares the presented secret to the stored hash", () => {
    const issued = issueAgentToken("credentialSynthetic01");
    const parsed = parseAgentToken(issued.token)!;

    expect(verifyAgentTokenSecret(parsed.secret, issued.secretHash)).toBe(true);
    expect(
      verifyAgentTokenSecret(
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        issued.secretHash
      )
    ).toBe(false);
    expect(verifyAgentTokenSecret(parsed.secret, "not-a-hash")).toBe(false);
  });
});
