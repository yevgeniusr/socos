"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { apiJson } from "@/lib/api-client";
import { getFocusLoopTarget } from "../../contacts/_components/dialog-focus";

function tomorrowLocal() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export default function ReminderDialog({
  contact,
  onClose,
  onSuccess,
}: {
  contact: { id: string; name: string };
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [title, setTitle] = useState(`Follow up with ${contact.name}`);
  const [scheduledAt, setScheduledAt] = useState(tomorrowLocal());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLFormElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

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
      await apiJson("/api/reminders", {
        method: "POST",
        body: JSON.stringify({
          contactId: contact.id,
          type: "followup",
          title: title.trim(),
          scheduledAt: new Date(scheduledAt).toISOString(),
        }),
      });
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
          For {contact.name}
        </p>
        <label className="mt-4 block text-xs font-bold text-on-surface-variant">
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
