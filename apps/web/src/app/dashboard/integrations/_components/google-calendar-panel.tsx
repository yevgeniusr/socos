"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiJson } from "@/lib/api-client";
import type {
  CalendarConnectResponse,
  CalendarConnectionResponse,
  CalendarSourcesResponse,
  LoadableIntegration,
} from "@/lib/integration-contracts";
import {
  calendarAccessSummary,
  integrationFailure,
  type CalendarAccessSummary,
} from "../integration-view";
import ConfirmationDialog from "./confirmation-dialog";
import IntegrationSection from "./integration-section";

type CalendarPanelData = {
  connection: CalendarConnectionResponse;
  sources: CalendarSourcesResponse;
};

const CALENDAR_SOURCE_DISCOVERY_INTERVAL_MS = 500;
const CALENDAR_SOURCE_DISCOVERY_RETRY_LIMIT = 5;

export default function GoogleCalendarPanel({
  refreshToken,
  onSummaryChange,
}: {
  refreshToken: number;
  onSummaryChange: (summary: CalendarAccessSummary) => void;
}) {
  const [state, setState] = useState<LoadableIntegration<CalendarPanelData>>({
    status: "loading",
  });
  const [receipt, setReceipt] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [busy, setBusy] = useState(false);
  const receiptRef = useRef<HTMLParagraphElement>(null);
  const calendarEpochRef = useRef(0);
  const sourceVersionsRef = useRef(new Map<string, number>());
  const sourceQueuesRef = useRef(new Map<string, Promise<void>>());
  const sourceConfirmedRef = useRef(new Map<string, boolean>());
  const summary = useMemo(() => calendarAccessSummary(state), [state]);

  useEffect(() => {
    onSummaryChange(summary);
  }, [onSummaryChange, summary]);

  const loadCalendar = useCallback(async (signal?: AbortSignal) => {
    const epoch = ++calendarEpochRef.current;
    sourceVersionsRef.current.clear();
    sourceQueuesRef.current.clear();
    sourceConfirmedRef.current.clear();
    setState({ status: "loading" });
    try {
      const [connection, sources] = await Promise.all([
        apiJson<CalendarConnectionResponse>(
          "/api/integrations/google-calendar",
          { signal }
        ),
        apiJson<CalendarSourcesResponse>(
          "/api/integrations/google-calendar/sources",
          { signal }
        ),
      ]);
      if (calendarEpochRef.current === epoch) {
        sourceConfirmedRef.current = new Map(
          sources.map((source) => [source.id, source.selected])
        );
        setState({ status: "ready", data: { connection, sources } });
      }
    } catch (error) {
      if (signal?.aborted || calendarEpochRef.current !== epoch) return;
      setState(
        integrationFailure(error, "Google Calendar could not be loaded.")
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadCalendar(controller.signal);
    return () => {
      controller.abort();
      calendarEpochRef.current += 1;
    };
  }, [loadCalendar, refreshToken]);

  useEffect(() => {
    if (
      state.status !== "ready" ||
      state.data.connection?.status !== "active" ||
      state.data.sources.length > 0
    ) {
      return;
    }

    const controller = new AbortController();
    const epoch = calendarEpochRef.current;
    let attempts = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const scheduleRefresh = () => {
      if (
        controller.signal.aborted ||
        attempts >= CALENDAR_SOURCE_DISCOVERY_RETRY_LIMIT
      ) {
        return;
      }
      timeout = setTimeout(() => {
        void refreshSources();
      }, CALENDAR_SOURCE_DISCOVERY_INTERVAL_MS);
    };

    const refreshSources = async () => {
      attempts += 1;
      try {
        const sources = await apiJson<CalendarSourcesResponse>(
          "/api/integrations/google-calendar/sources",
          { signal: controller.signal }
        );
        if (controller.signal.aborted || calendarEpochRef.current !== epoch) {
          return;
        }
        if (!sources.length) {
          scheduleRefresh();
          return;
        }
        sourceConfirmedRef.current = new Map(
          sources.map((source) => [source.id, source.selected])
        );
        setState((current) =>
          current.status === "ready" &&
          current.data.connection?.status === "active" &&
          current.data.sources.length === 0
            ? {
                status: "ready",
                data: { ...current.data, sources },
              }
            : current
        );
      } catch {
        if (!controller.signal.aborted && calendarEpochRef.current === epoch) {
          scheduleRefresh();
        }
      }
    };

    scheduleRefresh();
    return () => {
      controller.abort();
      if (timeout) clearTimeout(timeout);
    };
  }, [state]);

  async function connect() {
    setBusy(true);
    setActionError(null);
    setReceipt(null);
    try {
      const response = await apiJson<CalendarConnectResponse>(
        "/api/integrations/google-calendar/connect",
        { method: "POST", body: JSON.stringify({}) }
      );
      window.location.assign(response.authorizationUrl);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Calendar connection failed."
      );
      setBusy(false);
    }
  }

  async function updateSource(sourceId: string, selected: boolean) {
    if (state.status !== "ready") return;
    const epoch = calendarEpochRef.current;
    const version = (sourceVersionsRef.current.get(sourceId) ?? 0) + 1;
    sourceVersionsRef.current.set(sourceId, version);
    if (!sourceConfirmedRef.current.has(sourceId)) {
      const source = state.data.sources.find((item) => item.id === sourceId);
      if (source) sourceConfirmedRef.current.set(sourceId, source.selected);
    }
    setActionError(null);
    setReceipt(null);
    setState((current) =>
      current.status === "ready" && current.data.connection?.status === "active"
        ? {
            status: "ready",
            data: {
              ...current.data,
              sources: current.data.sources.map((source) =>
                source.id === sourceId ? { ...source, selected } : source
              ),
            },
          }
        : current
    );

    const previous = sourceQueuesRef.current.get(sourceId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        if (calendarEpochRef.current !== epoch) return;
        try {
          await apiJson<void>(
            `/api/integrations/google-calendar/calendars/${encodeURIComponent(sourceId)}`,
            {
              method: "PATCH",
              body: JSON.stringify({ selected }),
            }
          );
          if (calendarEpochRef.current === epoch) {
            sourceConfirmedRef.current.set(sourceId, selected);
          }
          if (
            calendarEpochRef.current === epoch &&
            sourceVersionsRef.current.get(sourceId) === version
          ) {
            setReceipt("Calendar selection saved.");
          }
        } catch (error) {
          if (
            calendarEpochRef.current !== epoch ||
            sourceVersionsRef.current.get(sourceId) !== version
          ) {
            return;
          }
          setState((current) =>
            current.status === "ready" &&
            current.data.connection?.status === "active"
              ? {
                  status: "ready",
                  data: {
                    ...current.data,
                    sources: current.data.sources.map((source) =>
                      source.id === sourceId
                        ? {
                            ...source,
                            selected:
                              sourceConfirmedRef.current.get(sourceId) ??
                              source.selected,
                          }
                        : source
                    ),
                  },
                }
              : current
          );
          setActionError(
            error instanceof Error
              ? error.message
              : "Calendar selection failed."
          );
        }
      });
    sourceQueuesRef.current.set(sourceId, operation);
    await operation;
    if (sourceQueuesRef.current.get(sourceId) === operation) {
      sourceQueuesRef.current.delete(sourceId);
    }
  }

  async function disconnect() {
    calendarEpochRef.current += 1;
    sourceVersionsRef.current.clear();
    sourceQueuesRef.current.clear();
    sourceConfirmedRef.current.clear();
    setBusy(true);
    setActionError(null);
    setReceipt(null);
    try {
      await apiJson<void>("/api/integrations/google-calendar", {
        method: "DELETE",
      });
      setState({
        status: "ready",
        data: { connection: null, sources: [] },
      });
      setReceipt(
        "Google Calendar sync stopped. Socos started cleanup of Calendar-derived context and the synced connection; provider watch cleanup may remain pending. Other personal context is unchanged."
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Calendar disconnect failed."
      );
    } finally {
      setBusy(false);
      setConfirmingDisconnect(false);
    }
  }

  const connection = state.status === "ready" ? state.data.connection : null;
  const connectionActive = connection?.status === "active";
  const connectionLabel = !connection
    ? "Not connected"
    : connection.status === "active"
      ? "Connected"
      : connection.status === "needs_reauth"
        ? "Reconnect required"
        : connection.status === "disconnected"
          ? "Disconnected"
          : `Connection ${connection.status.replaceAll("_", " ")}`;
  const status =
    state.status === "loading"
      ? "Loading"
      : state.status === "disabled"
        ? "Not enabled"
        : state.status === "error"
          ? "Needs attention"
          : connectionLabel;

  return (
    <IntegrationSection
      title="Google Calendar"
      description="Read-only plans, availability, and calendar context."
      icon="calendar_month"
      status={status}
    >
      {state.status === "loading" ? (
        <p role="status" className="text-sm text-on-surface-variant">
          Loading Google Calendar...
        </p>
      ) : null}
      {state.status === "disabled" ? (
        <p className="text-sm leading-6 text-on-surface-variant">
          Calendar sync is not enabled for this deployment.
        </p>
      ) : null}
      {state.status === "error" ? (
        <div role="alert" className="space-y-3">
          <p className="text-sm text-error">{state.message}</p>
          <button
            type="button"
            onClick={() => void loadCalendar()}
            className="min-h-11 border border-outline-variant/60 px-4 text-sm font-bold text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            Retry Google Calendar
          </button>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-bold text-on-surface">
                {connectionActive
                  ? "Calendar connection is active."
                  : connectionLabel}
              </p>
              <p className="mt-1 text-xs text-on-surface-variant">
                {connection?.lastSyncedAt
                  ? `Last synced ${new Date(connection.lastSyncedAt).toLocaleString()}`
                  : "No sync has completed yet."}
              </p>
              {connection?.errorCode ? (
                <p className="mt-1 break-words text-xs text-error">
                  Connection issue: {connection.errorCode}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void connect()}
                className="min-h-11 bg-primary px-4 text-sm font-extrabold text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary disabled:opacity-50"
              >
                {busy
                  ? "Opening Google..."
                  : connection
                    ? "Reconnect Google Calendar"
                    : "Connect Google Calendar"}
              </button>
              {connectionActive ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmingDisconnect(true)}
                  className="min-h-11 border border-error/50 px-4 text-sm font-bold text-error focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                >
                  Disconnect Google Calendar
                </button>
              ) : null}
            </div>
          </div>

          {connectionActive && state.data.sources.length ? (
            <fieldset className="border-t border-outline-variant/25 pt-4">
              <legend className="mb-3 text-xs font-bold uppercase text-on-surface-variant">
                Included calendars
              </legend>
              <div className="space-y-2">
                {state.data.sources.map((source) => (
                  <label
                    key={source.id}
                    className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 bg-surface-container px-3 py-2"
                  >
                    <input
                      type="checkbox"
                      checked={source.selected}
                      onChange={(event) =>
                        void updateSource(source.id, event.target.checked)
                      }
                      aria-label={`Use ${source.name}`}
                      className="size-5 shrink-0 accent-secondary"
                    />
                    <span className="min-w-0">
                      <span className="block break-words text-sm font-bold text-on-surface">
                        {source.name}
                      </span>
                      <span className="block text-xs text-on-surface-variant">
                        {[source.isPrimary ? "Primary" : null, source.timeZone]
                          .filter(Boolean)
                          .join(" / ")}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
        </div>
      ) : null}

      {actionError ? (
        <p role="alert" className="mt-4 text-sm text-error">
          {actionError}
        </p>
      ) : null}
      {receipt ? (
        <p
          ref={receiptRef}
          role="status"
          tabIndex={-1}
          className="mt-4 text-sm text-secondary"
        >
          {receipt}
        </p>
      ) : null}
      {confirmingDisconnect ? (
        <ConfirmationDialog
          title="Disconnect Google Calendar"
          description="Stops new Calendar sync and starts cleanup of the synced Calendar connection and Calendar-derived context. Provider watch cleanup is best-effort, so cleanup may remain pending. This is not the full personal-context erasure control."
          confirmLabel="Disconnect"
          busy={busy}
          restoreFocusRef={receiptRef}
          onCancel={() => setConfirmingDisconnect(false)}
          onConfirm={() => void disconnect()}
        />
      ) : null}
    </IntegrationSection>
  );
}
