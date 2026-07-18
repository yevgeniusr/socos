import { ApiError } from "@/lib/api-client";
import type {
  CalendarConnectionsResponse,
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
  connections: CalendarConnectionsResponse;
  sources: CalendarSourcesResponse;
}>;

export type CalendarConnectionOverview = {
  activeCount: number;
  needsReauthCount: number;
  disconnectableCount: number;
  statusLabel: string;
  detailLabel: string;
  connectLabel: string;
  lastSyncedAt: string | null;
  errorCodes: string[];
};

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

export function calendarConnectionOverview(
  connections: CalendarConnectionsResponse
): CalendarConnectionOverview {
  const counts = new Map<string, number>();
  for (const connection of connections) {
    counts.set(connection.status, (counts.get(connection.status) ?? 0) + 1);
  }

  const activeCount = counts.get("active") ?? 0;
  const needsReauthCount = counts.get("needs_reauth") ?? 0;
  const disconnectableCount = connections.filter(
    (connection) => connection.status !== "disconnected"
  ).length;
  const statusLabel = calendarConnectionStatusLabel(connections, counts);

  let detailLabel = statusLabel;
  if (connections.length === 0) {
    detailLabel = "Not connected";
  } else if (connections.length === 1 && activeCount === 1) {
    detailLabel = "Calendar connection is active.";
  } else if (activeCount === connections.length) {
    detailLabel = `${activeCount} Calendar connections are active.`;
  } else if (activeCount > 0) {
    detailLabel = `${activeCount} of ${connections.length} Calendar connections ${activeCount === 1 ? "is" : "are"} active.`;
  } else if (needsReauthCount === connections.length) {
    detailLabel = `${needsReauthCount} Calendar connections require reconnection.`;
  }

  const lastSyncedAt = connections.reduce<string | null>((latest, item) => {
    if (!item.lastSyncedAt) return latest;
    if (!latest) return item.lastSyncedAt;
    return Date.parse(item.lastSyncedAt) > Date.parse(latest)
      ? item.lastSyncedAt
      : latest;
  }, null);
  const errorCodes = Array.from(
    new Set(
      connections.flatMap((connection) =>
        connection.errorCode ? [connection.errorCode] : []
      )
    )
  ).sort();

  return {
    activeCount,
    needsReauthCount,
    disconnectableCount,
    statusLabel,
    detailLabel,
    connectLabel:
      needsReauthCount > 0
        ? "Reconnect Google Calendar"
        : activeCount > 0
          ? "Connect another Google Calendar"
          : "Connect Google Calendar",
    lastSyncedAt,
    errorCodes,
  };
}

function calendarConnectionStatusLabel(
  connections: CalendarConnectionsResponse,
  counts: ReadonlyMap<string, number>
): string {
  if (connections.length === 0) return "Not connected";
  if (connections.length === 1) {
    switch (connections[0].status) {
      case "active":
        return "Connected";
      case "needs_reauth":
        return "Reconnect required";
      case "disconnected":
        return "Disconnected";
      default:
        return `Connection ${formatCalendarStatus(connections[0].status)}`;
    }
  }

  const orderedStatuses = ["active", "needs_reauth", "disconnected"];
  const remainingStatuses = Array.from(counts.keys())
    .filter((status) => !orderedStatuses.includes(status))
    .sort();
  return [...orderedStatuses, ...remainingStatuses]
    .flatMap((status) => {
      const count = counts.get(status) ?? 0;
      if (!count) return [];
      if (status === "active") return [`${count} connected`];
      if (status === "needs_reauth") return [`${count} reconnect required`];
      if (status === "disconnected") return [`${count} disconnected`];
      return [`${count} ${formatCalendarStatus(status)}`];
    })
    .join(" / ");
}

function formatCalendarStatus(status: string): string {
  return status.replaceAll("_", " ");
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

  const { connections, sources } = state.data;
  const overview = calendarConnectionOverview(connections);
  const sourceLabel = sources.length
    ? `${sources.filter((source) => source.selected).length} of ${sources.length} calendars included`
    : overview.activeCount > 0
      ? "Discovering calendars"
      : "No calendars available";
  if (overview.activeCount === 0) {
    if (overview.needsReauthCount > 0) {
      return {
        state: "review",
        accessLabel:
          overview.needsReauthCount === 1
            ? "Calendar reconnect required"
            : `${overview.needsReauthCount} accounts reconnect required`,
        sourceLabel,
      };
    }
    if (overview.disconnectableCount > 0) {
      return {
        state: "review",
        accessLabel: "Calendar needs attention",
        sourceLabel,
      };
    }
    return {
      state: "disconnected",
      accessLabel: "Calendar not connected",
      sourceLabel,
    };
  }

  const activeConnections = connections.filter(
    (connection) => connection.status === "active"
  );
  const exactReadOnly = activeConnections.every((connection) =>
    hasExactReadOnlyCalendarScopes(connection.grantedScopes)
  );
  const hasConnectionIssue = connections.some(
    (connection) =>
      connection.status !== "active" && connection.status !== "disconnected"
  );
  const accessLabel = !exactReadOnly
    ? "Scope needs review"
    : overview.needsReauthCount > 0
      ? `${overview.activeCount} read only / ${overview.needsReauthCount} reconnect required`
      : hasConnectionIssue
        ? "Calendar needs attention"
        : overview.activeCount === 1
          ? "Read only"
          : `${overview.activeCount} accounts read only`;
  return {
    state: exactReadOnly && !hasConnectionIssue ? "active" : "review",
    accessLabel,
    sourceLabel,
  };
}
