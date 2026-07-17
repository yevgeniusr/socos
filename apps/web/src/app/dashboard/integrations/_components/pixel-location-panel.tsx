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
  LoadableIntegration,
  LocationContextResponse,
  LocationDeviceResponse,
  LocationDevicesResponse,
} from "@/lib/integration-contracts";
import { integrationFailure } from "../integration-view";
import ConfirmationDialog from "./confirmation-dialog";
import IntegrationSection from "./integration-section";
import OneTimeCredentialsDialog from "./one-time-credentials-dialog";

type PixelPanelData = {
  devices: LocationDevicesResponse;
  context: LocationContextResponse;
};

type PixelCredentials = {
  username: string;
  password: string;
};

type CreatePixelResponse = {
  device: LocationDeviceResponse;
  credentials: PixelCredentials;
};

type RotatePixelResponse = {
  device: Omit<LocationDeviceResponse, "name" | "externalDeviceId">;
  credentials: PixelCredentials;
};

type PendingPixelAction =
  | { kind: "rotate"; device: LocationDeviceResponse }
  | { kind: "revoke"; device: LocationDeviceResponse };

const inputClass =
  "min-h-11 w-full min-w-0 border border-outline-variant/50 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary";

export default function PixelLocationPanel() {
  const [state, setState] = useState<LoadableIntegration<PixelPanelData>>({
    status: "loading",
  });
  const [name, setName] = useState("");
  const [externalDeviceId, setExternalDeviceId] = useState("");
  const [rawRetentionDays, setRawRetentionDays] = useState(30);
  const [derivedRetentionDays, setDerivedRetentionDays] = useState(365);
  const [credentials, setCredentials] = useState<PixelCredentials | null>(null);
  const [credentialReturnKind, setCredentialReturnKind] = useState<
    "receipt" | "rotate"
  >("receipt");
  const [pendingAction, setPendingAction] = useState<PendingPixelAction | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);
  const receiptRef = useRef<HTMLParagraphElement>(null);
  const credentialReturnFocusRef = useRef<HTMLElement | null>(null);
  const credentialDialogFocusRef = useRef<HTMLButtonElement>(null);

  const loadPixel = useCallback(async (signal?: AbortSignal) => {
    setState({ status: "loading" });
    try {
      const [devices, context] = await Promise.all([
        apiJson<LocationDevicesResponse>("/api/location-devices", { signal }),
        apiJson<LocationContextResponse>("/api/location-context/current", {
          signal,
        }),
      ]);
      setState({ status: "ready", data: { devices, context } });
    } catch (error) {
      if (signal?.aborted) return;
      setState(
        integrationFailure(error, "Pixel location could not be loaded.")
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadPixel(controller.signal);
    return () => controller.abort();
  }, [loadPixel]);

  async function createDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    credentialReturnFocusRef.current = null;
    setCredentialReturnKind("receipt");
    setBusy(true);
    setActionError(null);
    setReceipt(null);
    try {
      const response = await apiJson<CreatePixelResponse>(
        "/api/location-devices",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            externalDeviceId,
            rawRetentionDays,
            derivedRetentionDays,
          }),
        }
      );
      setCredentials(response.credentials);
      setName("");
      setExternalDeviceId("");
      setReceipt(
        "Pixel device created. Configure OwnTracks with the one-time credentials."
      );
      await loadPixel();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Pixel device creation failed."
      );
    } finally {
      setBusy(false);
    }
  }

  async function rotate(device: LocationDeviceResponse) {
    setBusy(true);
    setActionError(null);
    setReceipt(null);
    try {
      const response = await apiJson<RotatePixelResponse>(
        `/api/location-devices/${encodeURIComponent(device.id)}/rotate`,
        { method: "POST" }
      );
      setCredentialReturnKind("rotate");
      setCredentials(response.credentials);
      setReceipt("Pixel credentials rotated. Configure the replacement now.");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Credential rotation failed."
      );
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  }

  async function revoke(device: LocationDeviceResponse) {
    setBusy(true);
    setActionError(null);
    setReceipt(null);
    try {
      await apiJson<void>(
        `/api/location-devices/${encodeURIComponent(device.id)}`,
        { method: "DELETE" }
      );
      setReceipt(
        "Pixel device revoked. New location ingest has stopped; existing history remains."
      );
      await loadPixel();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Device revocation failed."
      );
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  }

  const activeDevices =
    state.status === "ready"
      ? state.data.devices.filter((device) => device.status === "active")
      : [];
  const latestDeviceSeenAt =
    state.status === "ready"
      ? state.data.devices.reduce<string | null>(
          (latest, device) =>
            device.lastSeenAt && (!latest || device.lastSeenAt > latest)
              ? device.lastSeenAt
              : latest,
          null
        )
      : null;
  const contextSourceLabel =
    state.status === "ready"
      ? {
          sample: "Device sample",
          visit: "Visit-derived",
          calendar: "Calendar-derived",
          fallback: "Fallback",
        }[state.data.context.source]
      : null;
  const status =
    state.status === "loading"
      ? "Loading"
      : state.status === "disabled"
        ? "Not enabled"
        : state.status === "error"
          ? "Needs attention"
          : activeDevices.some((device) => device.lastSeenAt)
            ? "Samples received"
            : activeDevices.length
              ? "Awaiting first sample"
              : state.data.devices.length
                ? "No active devices"
                : "Ready to enroll";

  return (
    <IntegrationSection
      title="Pixel location"
      description="OwnTracks enrollment and coarse current context, without coordinates."
      icon="location_on"
      status={status}
    >
      {state.status === "loading" ? (
        <p role="status" className="text-sm text-on-surface-variant">
          Loading Pixel location...
        </p>
      ) : null}
      {state.status === "disabled" ? (
        <p className="text-sm leading-6 text-on-surface-variant">
          Location ingest is not enabled for this deployment.
        </p>
      ) : null}
      {state.status === "error" ? (
        <div role="alert" className="space-y-3">
          <p className="text-sm text-error">{state.message}</p>
          <button
            type="button"
            onClick={() => void loadPixel()}
            className="min-h-11 border border-outline-variant/60 px-4 text-sm font-bold text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            Retry Pixel location
          </button>
        </div>
      ) : null}
      {state.status === "ready" ? (
        <div className="space-y-6">
          <div className="grid gap-3 border-b border-outline-variant/25 pb-5 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <p className="text-xs font-bold uppercase text-on-surface-variant">
                Current city
              </p>
              <p className="mt-1 break-words text-sm font-bold text-on-surface">
                {[state.data.context.city, state.data.context.countryCode]
                  .filter(Boolean)
                  .join(", ") || "Unavailable"}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-on-surface-variant">
                Context source
              </p>
              <p className="mt-1 break-words text-sm font-bold text-on-surface">
                {contextSourceLabel}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-on-surface-variant">
                Last device sample
              </p>
              <p className="mt-1 break-words text-sm font-bold text-on-surface">
                {latestDeviceSeenAt
                  ? new Date(latestDeviceSeenAt).toLocaleString()
                  : "No device samples received"}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-on-surface-variant">
                Time zone
              </p>
              <p className="mt-1 break-words text-sm font-bold text-on-surface">
                {state.data.context.timeZone ?? "Unavailable"}
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-on-surface-variant">
                Distance context
              </p>
              <p className="mt-1 text-sm font-bold text-on-surface">
                {state.data.context.distanceCapability
                  ? "Available"
                  : "Unavailable"}
              </p>
            </div>
          </div>

          {state.data.devices.length ? (
            <div className="space-y-3">
              <h3 className="text-xs font-bold uppercase text-on-surface-variant">
                Enrolled devices
              </h3>
              {state.data.devices.map((device) => (
                <div
                  key={device.id}
                  className="min-w-0 bg-surface-container px-3 py-3 sm:px-4"
                >
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-extrabold text-on-surface">
                        {device.name}
                      </p>
                      <p className="mt-1 break-all text-xs text-on-surface-variant">
                        {device.externalDeviceId} / {device.rawRetentionDays}d
                        raw / {device.derivedRetentionDays}d derived
                      </p>
                      <p className="mt-1 text-xs font-bold uppercase text-secondary">
                        {device.status === "revoked"
                          ? "Revoked"
                          : device.status === "active" && !device.lastSeenAt
                            ? "Enrolled / awaiting first sample"
                            : device.status === "active" && device.lastSeenAt
                              ? `Active / last sample ${new Date(device.lastSeenAt).toLocaleString()}`
                              : device.status}
                      </p>
                    </div>
                    {device.status === "active" ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`Rotate credentials for ${device.name}`}
                          title={`Rotate credentials for ${device.name}`}
                          onClick={(event) => {
                            credentialReturnFocusRef.current =
                              event.currentTarget;
                            setPendingAction({ kind: "rotate", device });
                          }}
                          className="flex size-11 items-center justify-center border border-outline-variant/60 text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                        >
                          <span
                            className="material-symbols-outlined"
                            aria-hidden="true"
                          >
                            key
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`Revoke ${device.name}`}
                          title={`Revoke ${device.name}`}
                          onClick={() =>
                            setPendingAction({ kind: "revoke", device })
                          }
                          className="flex size-11 items-center justify-center border border-error/50 text-error focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                        >
                          <span
                            className="material-symbols-outlined"
                            aria-hidden="true"
                          >
                            block
                          </span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <form
            onSubmit={(event) => void createDevice(event)}
            className="border-t border-outline-variant/25 pt-5"
          >
            <h3 className="text-sm font-extrabold text-on-surface">
              Enroll a Pixel
            </h3>
            <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
              <label className="min-w-0 text-xs font-bold text-on-surface-variant">
                Device name
                <input
                  required
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="min-w-0 text-xs font-bold text-on-surface-variant">
                External device ID
                <input
                  required
                  maxLength={128}
                  value={externalDeviceId}
                  onChange={(event) => setExternalDeviceId(event.target.value)}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="min-w-0 text-xs font-bold text-on-surface-variant">
                Raw retention days
                <input
                  required
                  type="number"
                  min={30}
                  max={365}
                  value={rawRetentionDays}
                  onChange={(event) =>
                    setRawRetentionDays(event.target.valueAsNumber)
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="min-w-0 text-xs font-bold text-on-surface-variant">
                Derived retention days
                <input
                  required
                  type="number"
                  min={90}
                  max={3650}
                  value={derivedRetentionDays}
                  onChange={(event) =>
                    setDerivedRetentionDays(event.target.valueAsNumber)
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
              {busy ? "Creating..." : "Create Pixel device"}
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

      {pendingAction?.kind === "rotate" ? (
        <ConfirmationDialog
          title="Rotate Pixel credentials"
          description="Existing credentials will stop working immediately. The replacement password is shown only once."
          confirmLabel="Rotate credentials"
          busy={busy}
          restoreFocusRef={credentialDialogFocusRef}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void rotate(pendingAction.device)}
        />
      ) : null}
      {pendingAction?.kind === "revoke" ? (
        <ConfirmationDialog
          title="Revoke Pixel device"
          description="Stops new location ingest. Existing location history is not deleted."
          confirmLabel="Revoke device"
          busy={busy}
          restoreFocusRef={receiptRef}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void revoke(pendingAction.device)}
        />
      ) : null}
      {credentials ? (
        <OneTimeCredentialsDialog
          endpoint={`${window.location.origin}/api/location/owntracks`}
          username={credentials.username}
          password={credentials.password}
          initialFocusRef={credentialDialogFocusRef}
          restoreFocusRef={
            credentialReturnKind === "receipt"
              ? receiptRef
              : credentialReturnFocusRef
          }
          onClose={() => setCredentials(null)}
        />
      ) : null}
    </IntegrationSection>
  );
}
