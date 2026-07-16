import { beforeEach, describe, expect, it, vi } from "vitest";

import { authFetch } from "@/lib/auth";
import { apiJson } from "./api-client";
import type { ApiError } from "./api-client";

vi.mock("@/lib/auth", () => ({ authFetch: vi.fn() }));

const mockedAuthFetch = vi.mocked(authFetch);

describe("apiJson errors", () => {
  beforeEach(() => mockedAuthFetch.mockReset());

  it("retains a safe top-level API error code", async () => {
    mockedAuthFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "BRIEF_NOT_READY",
          message: "Today's brief is not ready.",
        }),
        { status: 404, headers: { "content-type": "application/json" } }
      )
    );

    await expect(apiJson("/api/briefs/today")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      code: "BRIEF_NOT_READY",
      message: "Today's brief is not ready.",
    } satisfies Partial<ApiError>);
  });

  it.each([
    [{ message: ["First", "Second"] }, "First, Second"],
    ["Plain failure", "Plain failure"],
    [{ message: "Structured failure", code: 42 }, "Structured failure"],
  ])("keeps existing messages without inventing a code", async (body, message) => {
    mockedAuthFetch.mockResolvedValue(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status: 400,
        headers:
          typeof body === "string"
            ? undefined
            : { "content-type": "application/json" },
      })
    );

    const failure = await apiJson("/api/test").catch((error: unknown) => error);
    expect(failure).toMatchObject({ name: "ApiError", status: 400, message });
    expect((failure as ApiError).code).toBeUndefined();
  });

  it("wraps malformed JSON errors with the HTTP status", async () => {
    mockedAuthFetch.mockResolvedValue(
      new Response("{", {
        status: 502,
        headers: { "content-type": "application/json" },
      })
    );

    await expect(apiJson("/api/test")).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
      message: "Request failed with status 502",
    });
  });
});
