import { ApiError } from "@/lib/api-client";
import type { LoadableIntegration } from "@/lib/integration-contracts";

type IntegrationFailure = Extract<
  LoadableIntegration<never>,
  { status: "disabled" | "error" }
>;

export function integrationFailure(
  error: unknown,
  fallback: string
): IntegrationFailure {
  if (
    error instanceof ApiError &&
    error.status === 503 &&
    error.code === "integration_not_configured"
  ) {
    return { status: "disabled" };
  }

  return {
    status: "error",
    message: error instanceof Error && error.message ? error.message : fallback,
  };
}

export function parseCalendarResult(
  value: string | null
): "connected" | "error" | null {
  return value === "connected" || value === "error" ? value : null;
}
