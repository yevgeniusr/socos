"use client";

import { useState, type FormEvent } from "react";

import { apiJson } from "@/lib/api-client";
import type {
  ContactDetail,
  ContactFieldInput,
  ContactFieldWriteType,
  SocialLinks,
  UpdateContactPayload,
} from "@/lib/contact-contracts";

const FIELD_TYPES: ContactFieldWriteType[] = [
  "email",
  "phone",
  "address",
  "website",
  "other",
];
const SOCIAL_KEYS: Array<keyof SocialLinks> = [
  "linkedin",
  "twitter",
  "instagram",
  "facebook",
  "github",
  "website",
];
const inputClass =
  "mt-1 min-h-11 w-full rounded-lg border border-outline-variant/30 bg-surface-container-high px-3 text-sm text-on-surface focus:border-primary focus:outline-none";

function dateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function isoDate(value: string) {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

function values(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

interface EditableField {
  key: string;
  type: string;
  value: string;
  label: string;
  isPrimary: boolean;
}

export default function ContactEditor({
  contact,
  onSuccess,
  onCancel,
}: {
  contact: ContactDetail;
  onSuccess: () => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({
    firstName: contact.firstName,
    lastName: contact.lastName ?? "",
    nickname: contact.nickname ?? "",
    photo: contact.photo ?? "",
    company: contact.company ?? "",
    jobTitle: contact.jobTitle ?? "",
    bio: contact.bio ?? "",
    birthday: dateInput(contact.birthday),
    anniversary: dateInput(contact.anniversary),
    firstMetDate: dateInput(contact.firstMetDate),
    firstMetContext: contact.firstMetContext ?? "",
    labels: contact.labels.join(", "),
    tags: contact.tags.join(", "),
    groups: contact.groups.join(", "),
    importance: String(contact.importance),
    preferredCadenceDays: String(contact.preferredCadenceDays),
  });
  const [socialLinks, setSocialLinks] = useState<Record<string, string>>(
    () => ({ ...contact.socialLinks })
  );
  const [fields, setFields] = useState<EditableField[]>(() =>
    contact.contactFields.map((field) => ({
      key: field.id,
      type: field.type,
      value: field.value,
      label: field.label ?? "",
      isPrimary: field.isPrimary,
    }))
  );
  const [fieldsDirty, setFieldsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function updateDraft(key: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateField(key: string, next: Partial<EditableField>) {
    setFieldsDirty(true);
    setFields((current) =>
      current.map((field) =>
        field.key === key ? { ...field, ...next } : field
      )
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.firstName.trim()) {
      setError("First name is required.");
      return;
    }

    let contactFields: ContactFieldInput[] | undefined;
    if (fieldsDirty) {
      if (fields.some((field) => !field.value.trim())) {
        setError("Contact method values cannot be blank.");
        return;
      }
      contactFields = fields.map((field) => ({
        type: FIELD_TYPES.includes(field.type as ContactFieldWriteType)
          ? (field.type as ContactFieldWriteType)
          : "other",
        value: field.value.trim(),
        ...(field.label.trim() ? { label: field.label.trim() } : {}),
        isPrimary: field.isPrimary,
      }));
      const primaryTypes = new Set<string>();
      for (const field of contactFields) {
        if (!field.isPrimary) continue;
        if (primaryTypes.has(field.type)) {
          setError(`Only one primary ${field.type} method is allowed.`);
          return;
        }
        primaryTypes.add(field.type);
      }
    }

    const links = Object.fromEntries(
      Object.entries(socialLinks)
        .map(([key, value]) => [key, value.trim()])
        .filter(([, value]) => value)
    ) as SocialLinks;
    const payload: UpdateContactPayload = {
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      nickname: draft.nickname.trim(),
      photo: draft.photo.trim(),
      company: draft.company.trim(),
      jobTitle: draft.jobTitle.trim(),
      bio: draft.bio.trim(),
      birthday: isoDate(draft.birthday),
      anniversary: isoDate(draft.anniversary),
      firstMetDate: isoDate(draft.firstMetDate),
      firstMetContext: draft.firstMetContext.trim() || null,
      labels: values(draft.labels),
      tags: values(draft.tags),
      groups: values(draft.groups),
      importance: Number(draft.importance),
      preferredCadenceDays: Number(draft.preferredCadenceDays),
      socialLinks: links,
      ...(contactFields ? { contactFields } : {}),
    };

    setSaving(true);
    setError("");
    try {
      await apiJson(`/api/contacts/${encodeURIComponent(contact.id)}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      await onSuccess();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not update the contact."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="space-y-6 pb-8"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-on-surface-variant">
          First name
          <input
            required
            value={draft.firstName}
            onChange={(event) => updateDraft("firstName", event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-semibold text-on-surface-variant">
          Last name
          <input
            value={draft.lastName}
            onChange={(event) => updateDraft("lastName", event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-semibold text-on-surface-variant">
          Nickname
          <input
            value={draft.nickname}
            onChange={(event) => updateDraft("nickname", event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-semibold text-on-surface-variant">
          Photo URL
          <input
            type="url"
            value={draft.photo}
            onChange={(event) => updateDraft("photo", event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-semibold text-on-surface-variant">
          Company
          <input
            value={draft.company}
            onChange={(event) => updateDraft("company", event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-semibold text-on-surface-variant">
          Job title
          <input
            value={draft.jobTitle}
            onChange={(event) => updateDraft("jobTitle", event.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      <label className="block text-xs font-semibold text-on-surface-variant">
        Bio
        <textarea
          value={draft.bio}
          onChange={(event) => updateDraft("bio", event.target.value)}
          rows={4}
          className={`${inputClass} py-2`}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-semibold text-on-surface-variant">
          Birthday
          <input
            type="date"
            value={draft.birthday}
            onChange={(event) => updateDraft("birthday", event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-semibold text-on-surface-variant">
          Anniversary
          <input
            type="date"
            value={draft.anniversary}
            onChange={(event) => updateDraft("anniversary", event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-semibold text-on-surface-variant">
          First met
          <input
            type="date"
            value={draft.firstMetDate}
            onChange={(event) =>
              updateDraft("firstMetDate", event.target.value)
            }
            className={inputClass}
          />
        </label>
      </div>
      <label className="block text-xs font-semibold text-on-surface-variant">
        First met context
        <input
          value={draft.firstMetContext}
          onChange={(event) =>
            updateDraft("firstMetContext", event.target.value)
          }
          className={inputClass}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-semibold text-on-surface-variant">
          Labels
          <input
            value={draft.labels}
            onChange={(event) => updateDraft("labels", event.target.value)}
            placeholder="Comma separated"
            className={inputClass}
          />
        </label>
        <label className="text-xs font-semibold text-on-surface-variant">
          Tags
          <input
            value={draft.tags}
            onChange={(event) => updateDraft("tags", event.target.value)}
            placeholder="Comma separated"
            className={inputClass}
          />
        </label>
        <label className="text-xs font-semibold text-on-surface-variant">
          Groups
          <input
            value={draft.groups}
            onChange={(event) => updateDraft("groups", event.target.value)}
            placeholder="Comma separated"
            className={inputClass}
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-on-surface-variant">
          Importance (1-5)
          <input
            type="number"
            min="1"
            max="5"
            required
            value={draft.importance}
            onChange={(event) => updateDraft("importance", event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-xs font-semibold text-on-surface-variant">
          Cadence in days
          <input
            type="number"
            min="7"
            max="365"
            required
            value={draft.preferredCadenceDays}
            onChange={(event) =>
              updateDraft("preferredCadenceDays", event.target.value)
            }
            className={inputClass}
          />
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-bold">Contact methods</legend>
        {fields.map((field) => {
          const supported = FIELD_TYPES.includes(
            field.type as ContactFieldWriteType
          );
          return (
            <div
              key={field.key}
              className="grid gap-2 rounded-lg border border-outline-variant/20 p-3 sm:grid-cols-[120px_minmax(0,1fr)_120px_44px]"
            >
              <label className="text-xs font-semibold text-on-surface-variant">
                Type
                <select
                  value={supported ? field.type : "other"}
                  onChange={(event) =>
                    updateField(field.key, { type: event.target.value })
                  }
                  className={inputClass}
                >
                  {FIELD_TYPES.map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
                {!supported ? (
                  <span className="mt-1 block text-[10px] text-tertiary">
                    Stored as {field.type}; saved as other only if methods are
                    edited.
                  </span>
                ) : null}
              </label>
              <label className="text-xs font-semibold text-on-surface-variant">
                Value
                <input
                  value={field.value}
                  onChange={(event) =>
                    updateField(field.key, { value: event.target.value })
                  }
                  className={inputClass}
                />
              </label>
              <label className="text-xs font-semibold text-on-surface-variant">
                Label
                <input
                  value={field.label}
                  onChange={(event) =>
                    updateField(field.key, { label: event.target.value })
                  }
                  className={inputClass}
                />
              </label>
              <div className="flex items-end gap-1">
                <label className="flex min-h-11 items-center gap-2 text-xs text-on-surface-variant">
                  <input
                    type="checkbox"
                    checked={field.isPrimary}
                    onChange={(event) =>
                      updateField(field.key, {
                        isPrimary: event.target.checked,
                      })
                    }
                  />{" "}
                  Primary
                </label>
                <button
                  type="button"
                  aria-label="Remove contact method"
                  title="Remove"
                  onClick={() => {
                    setFieldsDirty(true);
                    setFields((current) =>
                      current.filter((item) => item.key !== field.key)
                    );
                  }}
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg text-error hover:bg-error-container/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span
                    className="material-symbols-outlined"
                    aria-hidden="true"
                  >
                    delete
                  </span>
                </button>
              </div>
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => {
            setFieldsDirty(true);
            setFields((current) => [
              ...current,
              {
                key: `new-${current.length}-${Date.now()}`,
                type: "email",
                value: "",
                label: "",
                isPrimary: false,
              },
            ]);
          }}
          className="flex min-h-11 items-center gap-2 rounded-lg border border-outline-variant/30 px-3 text-sm font-bold text-primary hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            add
          </span>
          Add method
        </button>
      </fieldset>

      <fieldset className="grid gap-3 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-bold">Social links</legend>
        {SOCIAL_KEYS.map((key) => (
          <label
            key={key}
            className="text-xs font-semibold capitalize text-on-surface-variant"
          >
            {key}
            <input
              type="url"
              value={socialLinks[key] ?? ""}
              onChange={(event) =>
                setSocialLinks((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }
              className={inputClass}
            />
          </label>
        ))}
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      ) : null}
      <div className="sticky bottom-0 flex gap-3 border-t border-outline-variant/20 bg-surface py-3">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 flex-1 rounded-lg border border-outline-variant/30 px-4 text-sm font-bold text-on-surface-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 flex-1 rounded-lg bg-primary px-4 text-sm font-bold text-on-primary disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          {saving ? "Saving..." : "Save changes"}
        </button>
      </div>
    </form>
  );
}
