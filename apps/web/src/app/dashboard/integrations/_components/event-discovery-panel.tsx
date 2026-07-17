"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { apiJson } from "@/lib/api-client";
import type {
  EventPreferenceResponse,
  EventSourceResponse,
  EventSourcesResponse,
  LoadableIntegration,
} from "@/lib/integration-contracts";
import { integrationFailure } from "../integration-view";
import ConfirmationDialog from "./confirmation-dialog";
import IntegrationSection from "./integration-section";

type EventPanelData = {
  sources: EventSourcesResponse;
  preference: EventPreferenceResponse;
};

type PendingEventAction =
  | { kind: "disable"; source: EventSourceResponse }
  | { kind: "remove"; source: EventSourceResponse };

const inputClass =
  "min-h-11 w-full min-w-0 border border-outline-variant/50 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary";

function formatTimestamp(value: string | null) {
  if (!value) return "Never";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime())
    ? "Unavailable"
    : timestamp.toLocaleString();
}

export default function EventDiscoveryPanel() {
  const [state, setState] = useState<LoadableIntegration<EventPanelData>>({
    status: "loading",
  });
  const [sourceName, setSourceName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [city, setCity] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [socialWeight, setSocialWeight] = useState(5);
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState(60);
  const [interestTags, setInterestTags] = useState("");
  const [maxDistanceKm, setMaxDistanceKm] = useState(25);
  const [travelSpeedKph, setTravelSpeedKph] = useState(35);
  const [travelBufferMinutes, setTravelBufferMinutes] = useState(20);
  const [pendingAction, setPendingAction] = useState<PendingEventAction | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const receiptRef = useRef<HTMLParagraphElement>(null);

  const loadEvents = useCallback(async (signal?: AbortSignal) => {
    setState({ status: "loading" });
    try {
      const [sources, preference] = await Promise.all([
        apiJson<EventSourcesResponse>("/api/event-sources", { signal }),
        apiJson<EventPreferenceResponse>("/api/event-preferences", { signal }),
      ]);
      setState({ status: "ready", data: { sources, preference } });
      if (preference) {
        setInterestTags(preference.interestTags.join(", "));
        setMaxDistanceKm(preference.maxDistanceKm);
        setTravelSpeedKph(preference.travelSpeedKph);
        setTravelBufferMinutes(preference.travelBufferMinutes);
      }
    } catch (error) {
      if (signal?.aborted) return;
      setState(
        integrationFailure(error, "Event discovery could not be loaded.")
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadEvents(controller.signal);
    return () => controller.abort();
  }, [loadEvents]);

  async function createSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setActionError(null);
    setReceipt(null);
    try {
      const source = await apiJson<EventSourceResponse>("/api/event-sources", {
        method: "POST",
        body: JSON.stringify({
          name: sourceName,
          feedUrl,
          city,
          countryCode: countryCode.toUpperCase(),
          socialWeight,
          pollIntervalMinutes,
        }),
      });
      setState((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              data: {
                ...current.data,
                sources: [...current.data.sources, source],
              },
            }
          : current
      );
      setSourceName("");
      setFeedUrl("");
      setCity("");
      setCountryCode("");
      setReceipt(
        "Event source added. Its private feed URL is no longer shown."
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Event source creation failed."
      );
    } finally {
      setBusy(false);
    }
  }

  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setActionError(null);
    setReceipt(null);
    const tags = Array.from(
      new Set(
        interestTags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      )
    );
    try {
      const preference = await apiJson<NonNullable<EventPreferenceResponse>>(
        "/api/event-preferences",
        {
          method: "PUT",
          body: JSON.stringify({
            interestTags: tags,
            maxDistanceKm,
            travelSpeedKph,
            travelBufferMinutes,
          }),
        }
      );
      setState((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              data: { ...current.data, preference },
            }
          : current
      );
      setReceipt(
        "Event preferences saved for future Daily Brief recommendations."
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Preference save failed."
      );
    } finally {
      setBusy(false);
    }
  }

  async function setSourceStatus(
    source: EventSourceResponse,
    status: "active" | "disabled"
  ) {
    setBusy(true);
    setActionError(null);
    setReceipt(null);
    try {
      const updated = await apiJson<EventSourceResponse>(
        `/api/event-sources/${encodeURIComponent(source.id)}`,
        { method: "PATCH", body: JSON.stringify({ status }) }
      );
      setState((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              data: {
                ...current.data,
                sources: current.data.sources.map((item) =>
                  item.id === source.id ? updated : item
                ),
              },
            }
          : current
      );
      setReceipt(
        status === "disabled"
          ? "Event source disabled. Previously discovered context remains."
          : "Event source enabled."
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Source update failed."
      );
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  }

  async function removeSource(source: EventSourceResponse) {
    setBusy(true);
    setActionError(null);
    setReceipt(null);
    try {
      await apiJson<void>(
        `/api/event-sources/${encodeURIComponent(source.id)}`,
        {
          method: "DELETE",
        }
      );
      setState((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              data: {
                ...current.data,
                sources: current.data.sources.filter(
                  (item) => item.id !== source.id
                ),
              },
            }
          : current
      );
      setReceipt(
        "Event source, its discovered events, and related Daily Brief state were deleted. Unrelated personal data remains."
      );
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Source removal failed."
      );
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  }

  const status =
    state.status === "loading"
      ? "Loading"
      : state.status === "disabled"
        ? "Not enabled"
        : state.status === "error"
          ? "Needs attention"
          : state.data.sources.some(
                (source) => source.status === "error" || source.errorCode
              )
            ? "Polling error"
            : state.data.sources.some((source) => source.status === "active")
              ? "Polling active"
              : state.data.sources.length
                ? "Polling paused"
                : "Ready for sources";

  return (
    <IntegrationSection
      title="Event discovery"
      description="Certified ICS sources and balanced travel preferences for future briefs."
      icon="event_search"
      status={status}
    >
      {state.status === "loading" ? (
        <p role="status" className="text-sm text-on-surface-variant">
          Loading event discovery...
        </p>
      ) : null}
      {state.status === "disabled" ? (
        <p className="text-sm leading-6 text-on-surface-variant">
          Event discovery is not enabled for this deployment.
        </p>
      ) : null}
      {state.status === "error" ? (
        <div role="alert" className="space-y-3">
          <p className="text-sm text-error">{state.message}</p>
          <button
            type="button"
            onClick={() => void loadEvents()}
            className="min-h-11 border border-outline-variant/60 px-4 text-sm font-bold text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            Retry Event discovery
          </button>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <div className="space-y-7">
          {state.data.sources.length ? (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase text-on-surface-variant">
                Certified sources
              </h3>
              {state.data.sources.map((source) => (
                <div
                  key={source.id}
                  className="min-w-0 bg-surface-container px-3 py-3 sm:px-4"
                >
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-extrabold text-on-surface">
                        {source.name}
                      </p>
                      <p className="mt-1 break-all text-xs font-bold text-primary">
                        {source.allowedHost}
                      </p>
                      <p className="mt-1 break-words text-xs text-on-surface-variant">
                        {[
                          [source.city, source.countryCode]
                            .filter(Boolean)
                            .join(", "),
                          `Weight ${source.socialWeight}`,
                          `Poll every ${source.pollIntervalMinutes} min`,
                        ]
                          .filter(Boolean)
                          .join(" / ")}
                      </p>
                      <p className="mt-1 text-xs font-bold uppercase text-secondary">
                        {source.status}
                      </p>
                      {source.errorCode ? (
                        <p className="mt-1 break-words text-xs text-error">
                          Error: {source.errorCode}
                        </p>
                      ) : null}
                      <p className="mt-1 break-words text-xs text-on-surface-variant">
                        Last poll {formatTimestamp(source.lastPolledAt)} / Next
                        poll {formatTimestamp(source.nextPollAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {source.status === "active" ? (
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`Disable ${source.name}`}
                          title={`Disable ${source.name}`}
                          onClick={() =>
                            setPendingAction({ kind: "disable", source })
                          }
                          className="flex size-11 items-center justify-center border border-outline-variant/60 text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                        >
                          <span
                            className="material-symbols-outlined"
                            aria-hidden="true"
                          >
                            pause
                          </span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`Enable ${source.name}`}
                          title={`Enable ${source.name}`}
                          onClick={() => void setSourceStatus(source, "active")}
                          className="flex size-11 items-center justify-center border border-secondary/50 text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                        >
                          <span
                            className="material-symbols-outlined"
                            aria-hidden="true"
                          >
                            play_arrow
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        aria-label={`Remove ${source.name}`}
                        title={`Remove ${source.name}`}
                        onClick={() =>
                          setPendingAction({ kind: "remove", source })
                        }
                        className="flex size-11 items-center justify-center border border-error/50 text-error focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                      >
                        <span
                          className="material-symbols-outlined"
                          aria-hidden="true"
                        >
                          delete
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <form
            onSubmit={(event) => void createSource(event)}
            className="border-t border-outline-variant/25 pt-5"
          >
            <h3 className="text-sm font-extrabold text-on-surface">
              Add a certified ICS source
            </h3>
            <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
              <label className="min-w-0 text-xs font-bold text-on-surface-variant">
                Source name
                <input
                  required
                  maxLength={500}
                  value={sourceName}
                  onChange={(event) => setSourceName(event.target.value)}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="min-w-0 text-xs font-bold text-on-surface-variant">
                ICS feed URL
                <input
                  required
                  type="url"
                  maxLength={4096}
                  value={feedUrl}
                  onChange={(event) => setFeedUrl(event.target.value)}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="min-w-0 text-xs font-bold text-on-surface-variant">
                Source city
                <input
                  required
                  maxLength={500}
                  value={city}
                  onChange={(event) => setCity(event.target.value)}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="min-w-0 text-xs font-bold text-on-surface-variant">
                Source country code
                <input
                  required
                  minLength={2}
                  maxLength={2}
                  value={countryCode}
                  onChange={(event) => setCountryCode(event.target.value)}
                  className={`${inputClass} mt-1 uppercase`}
                />
              </label>
              <label className="min-w-0 text-xs font-bold text-on-surface-variant">
                Social weight
                <input
                  required
                  type="number"
                  min={0}
                  max={10}
                  value={socialWeight}
                  onChange={(event) =>
                    setSocialWeight(event.target.valueAsNumber)
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="min-w-0 text-xs font-bold text-on-surface-variant">
                Poll interval minutes
                <input
                  required
                  type="number"
                  min={15}
                  max={1440}
                  value={pollIntervalMinutes}
                  onChange={(event) =>
                    setPollIntervalMinutes(event.target.valueAsNumber)
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="mt-4 min-h-11 bg-primary px-4 text-sm font-extrabold text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary disabled:opacity-50"
            >
              {busy ? "Adding..." : "Add event source"}
            </button>
          </form>

          <form
            onSubmit={(event) => void savePreferences(event)}
            className="border-t border-outline-variant/25 pt-5"
          >
            <h3 className="text-sm font-extrabold text-on-surface">
              Balanced event preferences
            </h3>
            <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
              <label className="min-w-0 text-xs font-bold text-on-surface-variant sm:col-span-2">
                Interest tags
                <input
                  required
                  value={interestTags}
                  onChange={(event) => setInterestTags(event.target.value)}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="min-w-0 text-xs font-bold text-on-surface-variant">
                Maximum distance km
                <input
                  required
                  type="number"
                  min={1}
                  max={500}
                  step="any"
                  value={maxDistanceKm}
                  onChange={(event) =>
                    setMaxDistanceKm(event.target.valueAsNumber)
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="min-w-0 text-xs font-bold text-on-surface-variant">
                Travel speed kph
                <input
                  required
                  type="number"
                  min={1}
                  max={300}
                  value={travelSpeedKph}
                  onChange={(event) =>
                    setTravelSpeedKph(event.target.valueAsNumber)
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="min-w-0 text-xs font-bold text-on-surface-variant">
                Travel buffer minutes
                <input
                  required
                  type="number"
                  min={0}
                  max={240}
                  value={travelBufferMinutes}
                  onChange={(event) =>
                    setTravelBufferMinutes(event.target.valueAsNumber)
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="mt-4 min-h-11 bg-secondary px-4 text-sm font-extrabold text-on-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
            >
              {busy ? "Saving..." : "Save event preferences"}
            </button>
          </form>
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

      {pendingAction?.kind === "disable" ? (
        <ConfirmationDialog
          title="Disable event source"
          description="Stops future polling. Previously discovered event context remains in Socos."
          confirmLabel="Disable source"
          busy={busy}
          restoreFocusRef={receiptRef}
          onCancel={() => setPendingAction(null)}
          onConfirm={() =>
            void setSourceStatus(pendingAction.source, "disabled")
          }
        />
      ) : null}
      {pendingAction?.kind === "remove" ? (
        <ConfirmationDialog
          title="Remove event source"
          description="Deletes this source, its discovered events, and related Daily Brief state. Unrelated personal data remains."
          confirmLabel="Remove source"
          busy={busy}
          restoreFocusRef={receiptRef}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void removeSource(pendingAction.source)}
        />
      ) : null}
    </IntegrationSection>
  );
}
