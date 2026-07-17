import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api-client";
import { integrationFailure, parseCalendarResult } from "./integration-view";

describe("integrationFailure", () => {
  it("maps only the configured feature-gate response to disabled", () => {
    expect(
      integrationFailure(
        new ApiError(
          "Integration is not configured",
          503,
          "integration_not_configured"
        ),
        "fallback"
      )
    ).toEqual({ status: "disabled" });
  });

  it("keeps a 503 with another error code in the error state", () => {
    expect(
      integrationFailure(
        new ApiError("Service unavailable", 503, "service_unavailable"),
        "fallback"
      )
    ).toEqual({ status: "error", message: "Service unavailable" });
  });

  it("keeps integration_not_configured at another status in the error state", () => {
    expect(
      integrationFailure(
        new ApiError(
          "Integration is not configured",
          400,
          "integration_not_configured"
        ),
        "fallback"
      )
    ).toEqual({
      status: "error",
      message: "Integration is not configured",
    });
  });

  it("retains a safe message for a generic failure", () => {
    expect(integrationFailure(new Error("Request failed"), "fallback")).toEqual(
      { status: "error", message: "Request failed" }
    );
    expect(integrationFailure("private failure", "fallback")).toEqual({
      status: "error",
      message: "fallback",
    });
  });
});

describe("parseCalendarResult", () => {
  it.each(["connected", "error"] as const)("accepts %s", (result) => {
    expect(parseCalendarResult(result)).toBe(result);
  });

  it("rejects any other value", () => {
    expect(parseCalendarResult("anything-else")).toBeNull();
  });
});
