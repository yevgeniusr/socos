"use client";

import { useEffect, useRef, type RefObject } from "react";

type ConfirmationDialogProps = {
  title: string;
  description: string;
  confirmLabel: string;
  busy?: boolean;
  restoreFocus?: boolean;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
};

function focusTarget(
  restoreFocusRef: RefObject<HTMLElement | null> | undefined,
  fallback: HTMLElement | null
) {
  return restoreFocusRef?.current ?? fallback;
}

export default function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  busy = false,
  restoreFocus = true,
  restoreFocusRef,
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    return () => {
      if (!restoreFocus) return;
      requestAnimationFrame(() => {
        const target = focusTarget(restoreFocusRef, previousFocus);
        if (target?.isConnected && !target.matches(":disabled")) {
          target.focus();
        }
      });
    };
  }, [restoreFocus, restoreFocusRef]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-[90] bg-surface/85 sm:flex sm:items-center sm:justify-center sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={handleKeyDown}
        className="flex h-full w-full flex-col justify-between bg-surface-container p-5 sm:h-auto sm:max-w-md sm:border sm:border-outline-variant/40"
      >
        <div>
          <div className="mb-5 flex size-11 items-center justify-center bg-error-container text-on-error-container">
            <span className="material-symbols-outlined" aria-hidden="true">
              warning
            </span>
          </div>
          <h2 className="text-xl font-black text-on-surface">{title}</h2>
          <p className="mt-3 text-sm leading-6 text-on-surface-variant">
            {description}
          </p>
        </div>
        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-11 border border-outline-variant/60 px-4 text-sm font-bold text-on-surface hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="min-h-11 bg-error-container px-4 text-sm font-bold text-on-error-container hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
