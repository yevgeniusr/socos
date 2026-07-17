"use client";

import { useRef, useState, type FormEvent } from "react";

import { apiJson } from "@/lib/api-client";
import type {
  CreateInteractionPayload,
  InteractionReceiptEnvelope,
  InteractionType,
} from "@/lib/contact-contracts";
import { IntentRegistry } from "../../today/intent-registry";

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function InteractionForm({
  contactId,
  initialType = "note",
  onSuccess,
  onCancel,
}: {
  contactId: string;
  initialType?: InteractionType;
  onSuccess: (receipt: InteractionReceiptEnvelope) => Promise<void>;
  onCancel: () => void;
}) {
  const [type, setType] = useState<InteractionType>(initialType);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [occurredAt, setOccurredAt] = useState(localDateTimeValue());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const intents = useRef(new IntentRegistry());

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !content.trim() || !occurredAt) {
      setError("Title, notes, and date are required.");
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      contactId,
      type,
      title: title.trim(),
      content: content.trim(),
      occurredAt: new Date(occurredAt).toISOString(),
    } satisfies CreateInteractionPayload;
    try {
      const key = intents.current.keyFor(contactId, "interaction:create", payload);
      const receipt = await apiJson<InteractionReceiptEnvelope>("/api/interactions", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify(payload),
      });
      intents.current.resolve(contactId, "interaction:create", payload);
      await onSuccess(receipt);
      setTitle("");
      setContent("");
      setOccurredAt(localDateTimeValue());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not log the interaction."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="space-y-3 border-t border-outline-variant/20 pt-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">Log interaction</h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close interaction form"
          className="flex size-10 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            close
          </span>
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-on-surface-variant">
          Type
          <select
            value={type}
            onChange={(event) => setType(event.target.value as InteractionType)}
            className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/30 bg-surface-container-high px-3 text-sm text-on-surface focus:border-primary focus:outline-none"
          >
            {["call", "message", "meeting", "note", "email", "social"].map(
              (value) => (
                <option key={value}>{value}</option>
              )
            )}
          </select>
        </label>
        <label className="text-xs font-semibold text-on-surface-variant">
          Occurred at
          <input
            type="datetime-local"
            required
            value={occurredAt}
            onChange={(event) => setOccurredAt(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/30 bg-surface-container-high px-3 text-sm text-on-surface focus:border-primary focus:outline-none"
          />
        </label>
      </div>
      <label className="block text-xs font-semibold text-on-surface-variant">
        Title
        <input
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={200}
          className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/30 bg-surface-container-high px-3 text-sm text-on-surface focus:border-primary focus:outline-none"
        />
      </label>
      <label className="block text-xs font-semibold text-on-surface-variant">
        Notes
        <textarea
          required
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={3}
          className="mt-1 w-full resize-y rounded-lg border border-outline-variant/30 bg-surface-container-high px-3 py-2 text-sm text-on-surface focus:border-primary focus:outline-none"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="min-h-11 w-full rounded-lg bg-secondary px-4 text-sm font-bold text-on-secondary disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        {saving ? "Saving..." : "Log interaction"}
      </button>
    </form>
  );
}
