"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { getFocusLoopTarget } from "../../contacts/_components/dialog-focus";

export default function FeedbackDialog({
  mode,
  busy,
  error,
  onClose,
  onSnooze,
  onDismiss,
}: {
  mode: "snooze" | "dismiss";
  busy: boolean;
  error: string;
  onClose: () => void;
  onSnooze: (snoozedUntil: string) => Promise<void>;
  onDismiss: (reason: string) => Promise<void>;
}) {
  const [hours, setHours] = useState<24 | 168>(24);
  const [snoozedUntil, setSnoozedUntil] = useState(() =>
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  );
  const [reason, setReason] = useState("");
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
    if (mode === "snooze") await onSnooze(snoozedUntil);
    else await onDismiss(reason.trim());
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-3 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-dialog-title"
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-md rounded-lg border border-outline-variant/40 bg-surface-container p-4 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="feedback-dialog-title" className="text-base font-black">
            {mode === "snooze" ? "Snooze suggestion" : "Dismiss suggestion"}
          </h2>
          <button
            ref={closeRef}
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Close"
            className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </div>
        {mode === "snooze" ? (
          <fieldset className="mt-4 grid grid-cols-2 gap-2">
            <legend className="sr-only">Snooze duration</legend>
            {(
              [
                { label: "24 hours", value: 24 },
                { label: "7 days", value: 168 },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border px-3 text-sm font-bold ${hours === option.value ? "border-primary bg-primary/15 text-primary" : "border-outline-variant/40 text-on-surface-variant"}`}
              >
                <input
                  type="radio"
                  className="sr-only"
                  checked={hours === option.value}
                  onChange={() => {
                    setHours(option.value);
                    setSnoozedUntil(
                      new Date(
                        Date.now() + option.value * 60 * 60 * 1000
                      ).toISOString()
                    );
                  }}
                />
                {option.label}
              </label>
            ))}
          </fieldset>
        ) : (
          <label className="mt-4 block text-xs font-bold text-on-surface-variant">
            Optional reason
            <textarea
              maxLength={500}
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full resize-y rounded-lg border border-outline-variant/40 bg-surface-container-high p-3 text-sm text-on-surface focus:border-primary focus:outline-none"
            />
          </label>
        )}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-error">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 min-h-11 w-full rounded-lg bg-primary px-4 text-sm font-black text-on-primary disabled:opacity-60"
        >
          {busy ? "Saving..." : mode === "snooze" ? "Snooze" : "Dismiss"}
        </button>
      </form>
    </div>
  );
}
