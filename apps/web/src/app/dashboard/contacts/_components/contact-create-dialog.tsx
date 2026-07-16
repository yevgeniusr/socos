"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import { apiJson } from "@/lib/api-client";
import type {
  ContactDetail,
  CreateContactPayload,
} from "@/lib/contact-contracts";

const inputClass =
  "mt-1 min-h-11 w-full rounded-lg border border-outline-variant/30 bg-surface-container-high px-3 text-sm text-on-surface focus:border-primary focus:outline-none";
const emptyDraft = {
  firstName: "",
  lastName: "",
  company: "",
  jobTitle: "",
  labels: "",
  email: "",
  phone: "",
  birthday: "",
};

export default function ContactCreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    firstInputRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  function update(key: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.firstName.trim()) {
      setError("First name is required.");
      return;
    }
    const email = draft.email.trim();
    const phone = draft.phone.trim();
    const payload: CreateContactPayload = {
      firstName: draft.firstName.trim(),
      ...(draft.lastName.trim() ? { lastName: draft.lastName.trim() } : {}),
      ...(draft.company.trim() ? { company: draft.company.trim() } : {}),
      ...(draft.jobTitle.trim() ? { jobTitle: draft.jobTitle.trim() } : {}),
      labels: draft.labels
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      ...(draft.birthday
        ? {
            birthday: new Date(`${draft.birthday}T00:00:00.000Z`).toISOString(),
          }
        : {}),
      contactFields: [
        ...(email
          ? [
              {
                type: "email" as const,
                value: email,
                label: "personal",
                isPrimary: true,
              },
            ]
          : []),
        ...(phone
          ? [
              {
                type: "phone" as const,
                value: phone,
                label: "mobile",
                isPrimary: true,
              },
            ]
          : []),
      ],
    };
    setSaving(true);
    setError("");
    try {
      await apiJson<ContactDetail>("/api/contacts", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await onCreated();
      setDraft(emptyDraft);
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not create the contact."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-0 sm:p-4">
      <div
        className="absolute inset-0 bg-black/70"
        onMouseDown={onClose}
        aria-hidden="true"
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-contact-title"
        className="relative max-h-[100dvh] min-h-[100dvh] w-full overflow-y-auto bg-surface p-5 shadow-2xl sm:min-h-0 sm:max-w-lg sm:rounded-lg sm:border sm:border-outline-variant/30 sm:p-6"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id="create-contact-title" className="text-xl font-black">
            Add contact
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close add contact dialog"
            className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </div>
        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="space-y-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-on-surface-variant">
              First name
              <input
                ref={firstInputRef}
                required
                value={draft.firstName}
                onChange={(event) => update("firstName", event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="text-xs font-semibold text-on-surface-variant">
              Last name
              <input
                value={draft.lastName}
                onChange={(event) => update("lastName", event.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-on-surface-variant">
              Company
              <input
                value={draft.company}
                onChange={(event) => update("company", event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="text-xs font-semibold text-on-surface-variant">
              Job title
              <input
                value={draft.jobTitle}
                onChange={(event) => update("jobTitle", event.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <label className="block text-xs font-semibold text-on-surface-variant">
            Labels
            <input
              value={draft.labels}
              onChange={(event) => update("labels", event.target.value)}
              placeholder="Comma separated"
              className={inputClass}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-on-surface-variant">
              Email
              <input
                type="email"
                value={draft.email}
                onChange={(event) => update("email", event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="text-xs font-semibold text-on-surface-variant">
              Phone
              <input
                type="tel"
                value={draft.phone}
                onChange={(event) => update("phone", event.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <label className="block text-xs font-semibold text-on-surface-variant">
            Birthday
            <input
              type="date"
              value={draft.birthday}
              onChange={(event) => update("birthday", event.target.value)}
              className={inputClass}
            />
          </label>
          {error ? (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          ) : null}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 flex-1 rounded-lg border border-outline-variant/30 px-4 text-sm font-bold text-on-surface-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-11 flex-1 rounded-lg bg-primary px-4 text-sm font-bold text-on-primary disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              {saving ? "Creating..." : "Create contact"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
