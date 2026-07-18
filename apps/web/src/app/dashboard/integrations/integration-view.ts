import { ApiError } from "@/lib/api-client";
import type {
  CalendarConnectionResponse,
  CalendarSourcesResponse,
  LoadableIntegration,
} from "@/lib/integration-contracts";

const REQUIRED_READ_ONLY_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
] as const;

export const CALENDAR_SOURCE_DISCOVERY_SCHEDULE = {
  intervalMs: 3_000,
  retryLimit: 25,
} as const;

type CalendarPanelState = LoadableIntegration<{
  connection: CalendarConnectionResponse;
  sources: CalendarSourcesResponse;
}>;

export type CalendarAccessSummary = {
  state:
    | "loading"
    | "disabled"
    | "error"
    | "disconnected"
    | "active"
    | "review";
  accessLabel: string;
  sourceLabel: string;
};

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

export function hasExactReadOnlyCalendarScopes(scopes: string[]): boolean {
  if (scopes.length !== REQUIRED_READ_ONLY_CALENDAR_SCOPES.length) {
    return false;
  }
  if (new Set(scopes).size !== scopes.length) return false;
  return REQUIRED_READ_ONLY_CALENDAR_SCOPES.every((scope) =>
    scopes.includes(scope)
  );
}

export function calendarAccessSummary(
  state: CalendarPanelState
): CalendarAccessSummary {
  if (state.status === "loading") {
    return {
      state: "loading",
      accessLabel: "Checking Calendar access",
      sourceLabel: "Calendar sources loading",
    };
  }
  if (state.status === "disabled") {
    return {
      state: "disabled",
      accessLabel: "Calendar not enabled",
      sourceLabel: "Calendar sources unavailable",
    };
  }
  if (state.status === "error") {
    return {
      state: "error",
      accessLabel: "Calendar needs attention",
      sourceLabel: "Calendar sources unavailable",
    };
  }

  const { connection, sources } = state.data;
  if (!connection || connection.status !== "active") {
    return {
      state: "disconnected",
      accessLabel: "Calendar not connected",
      sourceLabel: sources.length
        ? `${sources.filter((source) => source.selected).length} of ${sources.length} calendars included`
        : "No calendars available",
    };
  }

  const exactReadOnly = hasExactReadOnlyCalendarScopes(
    connection.grantedScopes
  );
  return {
    state: exactReadOnly ? "active" : "review",
    accessLabel: exactReadOnly ? "Read only" : "Scope needs review",
    sourceLabel: sources.length
      ? `${sources.filter((source) => source.selected).length} of ${sources.length} calendars included`
      : "Discovering calendars",
  };
}
