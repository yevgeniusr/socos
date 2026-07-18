import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api-client";
import type {
  CalendarConnectionResponse,
  CalendarSourcesResponse,
  LoadableIntegration,
} from "@/lib/integration-contracts";
import {
  CALENDAR_SOURCE_DISCOVERY_SCHEDULE,
  calendarAccessSummary,
  hasExactReadOnlyCalendarScopes,
  integrationFailure,
  parseCalendarResult,
} from "./integration-view";

const REQUIRED_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];

type CalendarState = LoadableIntegration<{
  connection: CalendarConnectionResponse;
  sources: CalendarSourcesResponse;
}>;

const activeConnection = {
  id: "calendar-connection",
  status: "active",
  grantedScopes: REQUIRED_SCOPES,
  lastSyncedAt: null,
  errorCode: null,
  createdAt: "2026-07-17T08:00:00.000Z",
  updatedAt: "2026-07-17T08:00:00.000Z",
};

const sources = [
  {
    id: "primary",
    name: "Primary",
    timeZone: "Asia/Dubai",
    selected: true,
    isPrimary: true,
    fullSyncRequired: false,
    lastSyncedAt: null,
    errorCode: null,
  },
  {
    id: "shared",
    name: "Shared",
    timeZone: "Asia/Dubai",
    selected: false,
    isPrimary: false,
    fullSyncRequired: false,
    lastSyncedAt: null,
    errorCode: null,
  },
];

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

describe("hasExactReadOnlyCalendarScopes", () => {
  it("accepts exactly the two required read-only scopes in any order", () => {
    expect(hasExactReadOnlyCalendarScopes(REQUIRED_SCOPES)).toBe(true);
    expect(hasExactReadOnlyCalendarScopes([...REQUIRED_SCOPES].reverse())).toBe(
      true
    );
  });

  it.each([
    { scopes: [REQUIRED_SCOPES[0]] },
    { scopes: [...REQUIRED_SCOPES, REQUIRED_SCOPES[0]] },
    {
      scopes: [...REQUIRED_SCOPES, "https://www.googleapis.com/auth/calendar"],
    },
    { scopes: ["https://www.googleapis.com/auth/calendar.readonly"] },
  ])("rejects incomplete, duplicate, extra, or broad grants", ({ scopes }) => {
    expect(hasExactReadOnlyCalendarScopes(scopes)).toBe(false);
  });
});

describe("calendarAccessSummary", () => {
  it("reports discovery while an active connection has no calendar sources", () => {
    const state: CalendarState = {
      status: "ready",
      data: { connection: activeConnection, sources: [] },
    };

    expect(calendarAccessSummary(state)).toEqual({
      state: "active",
      accessLabel: "Read only",
      sourceLabel: "Discovering calendars",
    });
  });

  it("reports exact read-only access and selected source counts", () => {
    const state: CalendarState = {
      status: "ready",
      data: { connection: activeConnection, sources },
    };

    expect(calendarAccessSummary(state)).toEqual({
      state: "active",
      accessLabel: "Read only",
      sourceLabel: "1 of 2 calendars included",
    });
  });

  it("flags an active connection whose scopes do not match exactly", () => {
    const state: CalendarState = {
      status: "ready",
      data: {
        connection: {
          ...activeConnection,
          grantedScopes: [...REQUIRED_SCOPES, REQUIRED_SCOPES[0]],
        },
        sources,
      },
    };

    expect(calendarAccessSummary(state)).toEqual({
      state: "review",
      accessLabel: "Scope needs review",
      sourceLabel: "1 of 2 calendars included",
    });
  });

  it.each([
    [
      { status: "loading" } satisfies CalendarState,
      {
        state: "loading",
        accessLabel: "Checking Calendar access",
        sourceLabel: "Calendar sources loading",
      },
    ],
    [
      { status: "disabled" } satisfies CalendarState,
      {
        state: "disabled",
        accessLabel: "Calendar not enabled",
        sourceLabel: "Calendar sources unavailable",
      },
    ],
    [
      {
        status: "error",
        message: "private provider detail",
      } satisfies CalendarState,
      {
        state: "error",
        accessLabel: "Calendar needs attention",
        sourceLabel: "Calendar sources unavailable",
      },
    ],
    [
      {
        status: "ready",
        data: { connection: null, sources: [] },
      } satisfies CalendarState,
      {
        state: "disconnected",
        accessLabel: "Calendar not connected",
        sourceLabel: "No calendars available",
      },
    ],
  ])("reports a truthful non-active state", (state, expected) => {
    expect(calendarAccessSummary(state)).toEqual(expected);
  });
});

describe("Calendar source discovery schedule", () => {
  it("covers backend reconciliation while remaining bounded", () => {
    expect(CALENDAR_SOURCE_DISCOVERY_SCHEDULE.intervalMs).toBeGreaterThanOrEqual(
      1_000
    );
    expect(CALENDAR_SOURCE_DISCOVERY_SCHEDULE.retryLimit).toBeLessThanOrEqual(
      30
    );
    expect(
      CALENDAR_SOURCE_DISCOVERY_SCHEDULE.intervalMs *
        CALENDAR_SOURCE_DISCOVERY_SCHEDULE.retryLimit
    ).toBeGreaterThanOrEqual(75_000);
  });
});
