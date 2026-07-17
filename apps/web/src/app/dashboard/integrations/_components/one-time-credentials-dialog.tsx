"use client";

import { useEffect, useRef, type RefObject } from "react";

type OneTimeCredentialsDialogProps = {
  endpoint: string;
  username: string;
  password: string;
  initialFocusRef?: RefObject<HTMLButtonElement | null>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  onClose: () => void;
};

function focusTarget(
  restoreFocusRef: RefObject<HTMLElement | null> | undefined,
  fallback: HTMLElement | null
) {
  return restoreFocusRef?.current ?? fallback;
}

export default function OneTimeCredentialsDialog({
  endpoint,
  username,
  password,
  initialFocusRef,
  restoreFocusRef,
  onClose,
}: OneTimeCredentialsDialogProps) {
  const internalCloseRef = useRef<HTMLButtonElement>(null);
  const closeRef = initialFocusRef ?? internalCloseRef;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      requestAnimationFrame(() => {
        const target = focusTarget(restoreFocusRef, previousFocus);
        if (target?.isConnected && !target.matches(":disabled")) {
          target.focus();
        }
      });
    };
  }, [closeRef, restoreFocusRef]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Tab") {
      event.preventDefault();
      closeRef.current?.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-[95] bg-surface/90 sm:flex sm:items-center sm:justify-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="One-time Pixel credentials"
        onKeyDown={handleKeyDown}
        className="flex h-full w-full flex-col justify-between overflow-y-auto bg-surface-container p-5 sm:h-auto sm:max-w-lg sm:border sm:border-secondary/50"
      >
        <div className="min-w-0">
          <div className="mb-5 flex size-11 items-center justify-center bg-secondary text-on-secondary">
            <span className="material-symbols-outlined" aria-hidden="true">
              key
            </span>
          </div>
          <p className="text-xs font-bold uppercase text-secondary">
            Shown once
          </p>
          <h2 className="mt-1 text-xl font-black text-on-surface">
            One-time Pixel credentials
          </h2>
          <p className="mt-3 text-sm leading-6 text-on-surface-variant">
            Configure OwnTracks before closing. The password cannot be shown
            again.
          </p>
          <dl className="mt-6 min-w-0 space-y-4">
            {[
              ["Endpoint", endpoint],
              ["Username", username],
              ["Password", password],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs font-bold uppercase text-on-surface-variant">
                  {label}
                </dt>
                <dd className="mt-1 break-all bg-surface-container-lowest px-3 py-3 font-mono text-sm text-on-surface [overflow-wrap:anywhere]">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="mt-8 min-h-11 w-full bg-secondary px-4 text-sm font-extrabold text-on-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          Close credentials
        </button>
      </div>
    </div>
  );
}
