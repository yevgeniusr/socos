import {
  SafeProviderError,
  toSafeProviderError,
} from "./safe-provider-error.js";

describe("toSafeProviderError", () => {
  it.each([
    "google_rate_limited",
    "google_invalid_grant",
    "ics_timeout",
    "ics_invalid_response",
  ] as const)("converts provider failures to the fixed code %s", (code) => {
    const providerFailure = {
      message: "synthetic-sensitive-provider-message",
      config: { authorization: "synthetic-sensitive-provider-config" },
      response: { data: "synthetic-sensitive-provider-response" },
    };

    const error = toSafeProviderError(code, providerFailure);

    expect(error).toBeInstanceOf(SafeProviderError);
    expect(error).not.toBe(providerFailure);
    expect(error.code).toBe(code);
    expect(error.message).toBe("External provider request failed");
    expect(error).not.toHaveProperty("cause");
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("synthetic-sensitive-provider-message");
    expect(serialized).not.toContain("synthetic-sensitive-provider-config");
    expect(serialized).not.toContain("synthetic-sensitive-provider-response");
  });

  it("maps a non-allowlisted code to a fixed fallback", () => {
    const error = toSafeProviderError(
      "attacker-controlled-code" as "ics_timeout",
      new Error("synthetic-sensitive-provider-message")
    );

    expect(error.code).toBe("provider_unavailable");
    expect(JSON.stringify(error)).not.toContain(
      "synthetic-sensitive-provider-message"
    );
  });
});
