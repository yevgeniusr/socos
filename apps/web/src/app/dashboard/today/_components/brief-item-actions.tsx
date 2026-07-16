"use client";

import { useState } from "react";
import FeedbackDialog from "./snooze-dialog";

export default function BriefItemActions({ itemId, busy, error, onKeep, onSnooze, onDismiss, onReminder }: { itemId: string; busy: boolean; error: string; onKeep: (itemId: string) => Promise<boolean>; onSnooze: (itemId: string, hours: 24 | 168) => Promise<boolean>; onDismiss: (itemId: string, reason: string) => Promise<boolean>; onReminder?: () => void }) {
  const [dialog, setDialog] = useState<"snooze" | "dismiss" | null>(null);
  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2" aria-label="Suggestion actions">
        <button type="button" disabled={busy} onClick={() => void onKeep(itemId)} className="min-h-11 rounded-lg bg-primary px-3 text-sm font-black text-on-primary disabled:opacity-60">Keep</button>
        <button type="button" disabled={busy} onClick={() => setDialog("snooze")} className="min-h-11 rounded-lg border border-outline-variant/40 px-3 text-sm font-bold text-on-surface-variant disabled:opacity-60">Snooze</button>
        <button type="button" disabled={busy} onClick={() => setDialog("dismiss")} className="min-h-11 rounded-lg border border-outline-variant/40 px-3 text-sm font-bold text-on-surface-variant disabled:opacity-60">Dismiss</button>
        {onReminder ? <button type="button" disabled={busy} onClick={onReminder} aria-label="Create reminder" title="Create reminder" className="flex size-11 items-center justify-center rounded-lg border border-outline-variant/40 text-on-surface-variant disabled:opacity-60"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">notification_add</span></button> : null}
      </div>
      {error && !dialog ? <p role="alert" className="mt-2 text-sm text-error">{error}</p> : null}
      {dialog ? <FeedbackDialog mode={dialog} busy={busy} error={error} onClose={() => setDialog(null)} onSnooze={async (hours) => { if (await onSnooze(itemId, hours)) setDialog(null); }} onDismiss={async (reason) => { if (await onDismiss(itemId, reason)) setDialog(null); }} /> : null}
    </>
  );
}
