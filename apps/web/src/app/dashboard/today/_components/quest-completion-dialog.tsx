"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiJson } from "@/lib/api-client";
import type { DailyBrief, QuestAction } from "@/lib/cockpit-contracts";
import { IntentRegistry } from "../intent-registry";

type Quest = DailyBrief["quests"][number];
interface InteractionResponse {
  interaction: { id: string };
}

function localNow() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export default function QuestCompletionDialog({
  quest,
  onClose,
  onSuccess,
}: {
  quest: Quest;
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const [action, setAction] = useState<QuestAction | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [type, setType] = useState("message");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [occurredAt, setOccurredAt] = useState(localNow());
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const registry = useRef(new IntentRegistry());
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void apiJson<QuestAction>(
      `/api/briefs/quests/${encodeURIComponent(quest.questId)}/action`,
      { signal: controller.signal }
    )
      .then(setAction)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Could not load quest target."
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [quest.questId]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function completeQuest(id: string) {
    const body =
      action?.completionType === "reminder"
        ? { reminderId: id }
        : { interactionId: id };
    const key = registry.current.keyFor(quest.questId, "complete", body);
    await apiJson(
      `/api/briefs/quests/${encodeURIComponent(quest.questId)}/complete`,
      {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(body),
      }
    );
    registry.current.resolve(quest.questId, "complete", body);
  }

  async function submitInteraction(event: FormEvent) {
    event.preventDefault();
    if (!action || action.completionType !== "interaction") return;
    setBusy(true);
    setError("");
    try {
      let id = evidenceId;
      if (!id) {
        const created = await apiJson<InteractionResponse>(
          `/api/contacts/${encodeURIComponent(action.contact.id)}/interactions`,
          {
            method: "POST",
            body: JSON.stringify({
              type,
              title: title.trim(),
              content: notes.trim(),
              occurredAt: new Date(occurredAt).toISOString(),
            }),
          }
        );
        id = created.interaction.id;
        setEvidenceId(id);
      }
      await completeQuest(id);
      await onSuccess();
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not complete quest. Evidence is retained for retry."
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitReminder() {
    if (!action || action.completionType !== "reminder") return;
    setBusy(true);
    setError("");
    try {
      let id = evidenceId;
      if (!id) {
        if (action.reminder.status === "pending")
          await apiJson(
            `/api/reminders/${encodeURIComponent(action.reminder.id)}/complete`,
            { method: "PUT" }
          );
        id = action.reminder.id;
        setEvidenceId(id);
      }
      await completeQuest(id);
      await onSuccess();
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not complete quest. Evidence is retained for retry."
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
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quest-dialog-title"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg border border-outline-variant/40 bg-surface-container p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase text-secondary">
              +{quest.xpReward} XP
            </p>
            <h2 id="quest-dialog-title" className="text-base font-black">
              {quest.title}
            </h2>
          </div>
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
        {loading ? (
          <p aria-busy="true" className="mt-5 text-sm text-on-surface-variant">
            Loading verified target...
          </p>
        ) : null}
        {action?.completionType === "interaction" ? (
          <form
            onSubmit={(event) => void submitInteraction(event)}
            className="mt-4 space-y-3"
          >
            <p className="text-sm text-on-surface-variant">
              Log a real interaction with{" "}
              <strong className="text-on-surface">{action.contact.name}</strong>
              . The server verifies the evidence before awarding XP.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-on-surface-variant">
                Type
                <select
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/40 bg-surface-container-high px-3 text-sm text-on-surface"
                >
                  {[
                    "call",
                    "message",
                    "meeting",
                    "note",
                    "email",
                    "social",
                  ].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-bold text-on-surface-variant">
                Occurred at
                <input
                  type="datetime-local"
                  required
                  value={occurredAt}
                  onChange={(event) => setOccurredAt(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/40 bg-surface-container-high px-3 text-sm text-on-surface"
                />
              </label>
            </div>
            <label className="block text-xs font-bold text-on-surface-variant">
              Title
              <input
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/40 bg-surface-container-high px-3 text-sm text-on-surface"
              />
            </label>
            <label className="block text-xs font-bold text-on-surface-variant">
              Notes
              <textarea
                required
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="mt-1 w-full rounded-lg border border-outline-variant/40 bg-surface-container-high p-3 text-sm text-on-surface"
              />
            </label>
            {evidenceId ? (
              <p className="text-xs font-bold text-secondary">
                Interaction saved. Retrying quest verification only.
              </p>
            ) : null}
            <button
              type="submit"
              disabled={busy || !title.trim() || !notes.trim()}
              className="min-h-11 w-full rounded-lg bg-secondary px-4 text-sm font-black text-on-secondary disabled:opacity-60"
            >
              {busy
                ? "Verifying..."
                : evidenceId
                  ? "Retry verification"
                  : "Log and verify"}
            </button>
          </form>
        ) : null}
        {action?.completionType === "reminder" ? (
          <div className="mt-4">
            <p className="text-sm text-on-surface-variant">
              Complete the exact reminder for{" "}
              <strong className="text-on-surface">{action.contact.name}</strong>
              .
            </p>
            <div className="mt-3 rounded-lg border border-outline-variant/30 bg-surface-container-high p-3">
              <p className="font-bold">{action.reminder.title}</p>
              <p className="mt-1 text-xs text-on-surface-variant">
                {new Date(action.reminder.scheduledAt).toLocaleString()} ·{" "}
                {action.reminder.status}
              </p>
            </div>
            {evidenceId ? (
              <p className="mt-3 text-xs font-bold text-secondary">
                Reminder completed. Retrying quest verification only.
              </p>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitReminder()}
              className="mt-4 min-h-11 w-full rounded-lg bg-secondary px-4 text-sm font-black text-on-secondary disabled:opacity-60"
            >
              {busy
                ? "Verifying..."
                : evidenceId
                  ? "Retry verification"
                  : "Complete and verify"}
            </button>
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-error">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
