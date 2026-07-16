"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { apiJson } from "@/lib/api-client";
import { getFocusLoopTarget } from "../../contacts/_components/dialog-focus";
import {
  zonedLocalDateTimeToIso,
  type ReminderDraft,
} from "../cockpit-view";
import { IntentRegistry } from "../intent-registry";

export default function ReminderDialog({
  draft,
  onClose,
  onSuccess,
}: {
  draft: ReminderDraft;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [type, setType] = useState<ReminderDraft["type"]>(draft.type);
  const [title, setTitle] = useState(draft.title);
  const [scheduledAt, setScheduledAt] = useState(draft.scheduledAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLFormElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const registry = useRef(new IntentRegistry());

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!busy) {
          event.preventDefault();
          onClose();
        }
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      const target = getFocusLoopTarget(
        controls,
        document.activeElement,
        event.shiftKey
      );
      if (!target) return;
      event.preventDefault();
      target.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        contactId: draft.contact.id,
        type,
        title: title.trim(),
        scheduledAt: zonedLocalDateTimeToIso(scheduledAt, draft.timeZone),
      };
      const key = registry.current.keyFor(
        draft.contact.id,
        "reminder:create",
        body
      );
      await apiJson("/api/reminders", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(body),
      });
      registry.current.resolve(draft.contact.id, "reminder:create", body);
      onClose();
      void onSuccess().catch(() => undefined);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not create reminder."
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-3 sm:items-center"
    >
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reminder-title"
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-md rounded-lg border border-outline-variant/40 bg-surface-container p-4"
      >
        <div className="flex items-center justify-between">
          <h2 id="reminder-title" className="text-base font-black">
            Create reminder
          </h2>
          <button
            ref={closeRef}
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Close"
            className="flex size-11 items-center justify-center rounded-lg"
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </div>
        <p className="mt-1 text-sm text-on-surface-variant">
          For {draft.contact.name}
        </p>
        <p className="mt-1 text-xs text-on-surface-variant">
          {draft.sourceLabel}
        </p>
        <label className="mt-4 block text-xs font-bold text-on-surface-variant">
          Type
          <select
            value={type}
            onChange={(event) =>
              setType(event.target.value as ReminderDraft["type"])
            }
            className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/40 bg-surface-container-high px-3 text-sm text-on-surface"
          >
            <option value="followup">Follow-up</option>
            <option value="birthday">Birthday</option>
            <option value="anniversary">Anniversary</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="mt-3 block text-xs font-bold text-on-surface-variant">
          Title
          <input
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/40 bg-surface-container-high px-3 text-sm text-on-surface"
          />
        </label>
        <label className="mt-3 block text-xs font-bold text-on-surface-variant">
          Scheduled at
          <input
            required
            type="datetime-local"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/40 bg-surface-container-high px-3 text-sm text-on-surface"
          />
        </label>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-error">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="mt-4 min-h-11 w-full rounded-lg bg-tertiary-fixed-dim px-4 text-sm font-black text-on-tertiary-fixed disabled:opacity-60"
        >
          {busy ? "Saving..." : "Create reminder"}
        </button>
      </form>
    </div>
  );
}
