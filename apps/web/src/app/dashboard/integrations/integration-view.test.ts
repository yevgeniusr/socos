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
