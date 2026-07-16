"use client";

import { useState, type FormEvent } from "react";

import { apiJson } from "@/lib/api-client";
import type {
  CreateReminderPayload,
  ReminderType,
} from "@/lib/contact-contracts";

function tomorrowLocal() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(9, 0, 0, 0);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function ReminderForm({
  contactId,
  onSuccess,
  onCancel,
}: {
  contactId: string;
  onSuccess: () => Promise<void>;
  onCancel: () => void;
}) {
  const [type, setType] = useState<ReminderType>("followup");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledAt, setScheduledAt] = useState(tomorrowLocal());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !scheduledAt) {
      setError("Title and scheduled date are required.");
      return;
    }
    setSaving(true);
    setError("");
    const payload: CreateReminderPayload = {
      contactId,
      type,
      title: title.trim(),
      description: description.trim(),
      scheduledAt: new Date(scheduledAt).toISOString(),
    };
    try {
      await apiJson("/api/reminders", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await onSuccess();
      setTitle("");
      setDescription("");
      setScheduledAt(tomorrowLocal());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not create the reminder."
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
        <h3 className="text-sm font-bold">Schedule reminder</h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close reminder form"
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
            onChange={(event) => setType(event.target.value as ReminderType)}
            className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/30 bg-surface-container-high px-3 text-sm text-on-surface focus:border-primary focus:outline-none"
          >
            {["followup", "birthday", "anniversary", "custom"].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-on-surface-variant">
          Scheduled at
          <input
            type="datetime-local"
            required
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
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
        Description
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
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
        className="min-h-11 w-full rounded-lg bg-tertiary px-4 text-sm font-bold text-on-tertiary-fixed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        {saving ? "Saving..." : "Create reminder"}
      </button>
    </form>
  );
}
