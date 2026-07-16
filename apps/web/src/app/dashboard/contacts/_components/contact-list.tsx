"use client";

import type { ContactListItem } from "@/lib/contact-contracts";

export type ContactQuickAction = "call" | "message" | "reminder";

interface ContactListProps {
  contacts: ContactListItem[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onSelect: (contactId: string, trigger: HTMLButtonElement) => void;
  onQuickAction: (
    contactId: string,
    action: ContactQuickAction,
    trigger: HTMLButtonElement
  ) => void;
}

function displayName(contact: ContactListItem) {
  return [contact.firstName, contact.lastName].filter(Boolean).join(" ");
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function safePhoto(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

export default function ContactList({
  contacts,
  loading,
  error,
  onRetry,
  onSelect,
  onQuickAction,
}: ContactListProps) {
  if (loading) {
    return (
      <div className="space-y-2" aria-label="Loading contacts" aria-busy="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-[88px] animate-pulse rounded-lg bg-surface-container-low"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-error/40 bg-error-container/30 px-5 py-8 text-center"
      >
        <p className="text-sm text-error">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 min-h-11 rounded-lg bg-error px-4 text-sm font-bold text-on-error focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          Try again
        </button>
      </div>
    );
  }

  if (contacts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-outline-variant/40 px-5 py-14 text-center">
        <span
          className="material-symbols-outlined text-4xl text-on-surface-variant"
          aria-hidden="true"
        >
          person_search
        </span>
        <h2 className="mt-3 text-base font-bold">No contacts found</h2>
        <p className="mt-1 text-sm text-on-surface-variant">
          Adjust the search or filters, or add a contact.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2" aria-label="Contacts">
      {contacts.map((contact) => {
        const name = displayName(contact);
        const initials =
          `${contact.firstName[0] ?? ""}${contact.lastName?.[0] ?? ""}`.toUpperCase();
        const photo = safePhoto(contact.photo);
        return (
          <div
            key={contact.id}
            className="flex min-w-0 items-stretch rounded-lg border border-outline-variant/20 bg-surface-container-low transition-colors focus-within:border-primary/60 hover:bg-surface-container"
          >
            <button
              type="button"
              aria-label={`Open contact profile for ${name}`}
              onClick={(event) => onSelect(contact.id, event.currentTarget)}
              className="grid min-w-0 flex-1 grid-cols-[44px_minmax(0,1fr)] items-center gap-3 px-3 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:grid-cols-[48px_minmax(0,1fr)_120px] sm:px-4"
            >
              <div
                aria-hidden="true"
                className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-container-highest bg-cover bg-center text-xs font-black text-primary"
                style={
                  photo
                    ? { backgroundImage: `url(${JSON.stringify(photo)})` }
                    : undefined
                }
              >
                {photo ? null : initials}
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-bold text-on-surface">
                    {name}
                  </span>
                  <span
                    className="shrink-0 rounded bg-surface-container-highest px-1.5 py-0.5 text-[10px] font-bold text-secondary"
                    aria-label={`Relationship score ${contact.relationshipScore}`}
                  >
                    {contact.relationshipScore}
                  </span>
                </div>
                <p className="truncate text-xs text-on-surface-variant">
                  {contact.jobTitle ||
                    contact.company ||
                    contact.nickname ||
                    "No work details"}
                </p>
                <div className="mt-1 flex min-w-0 gap-1 overflow-hidden">
                  {contact.labels.slice(0, 2).map((label) => (
                    <span
                      key={label}
                      className="max-w-32 truncate rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary"
                    >
                      {label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="hidden text-right sm:block">
                <p className="text-[10px] uppercase text-on-surface-variant">
                  Last contact
                </p>
                <p className="mt-0.5 text-xs font-semibold">
                  {formatDate(contact.lastContactedAt)}
                </p>
              </div>
            </button>
            <div className="flex shrink-0 items-center border-l border-outline-variant/20 px-1 sm:px-2">
              {(
                [
                  ["call", "call"],
                  ["message", "chat"],
                  ["reminder", "notifications_active"],
                ] as const
              ).map(([action, icon]) => (
                <button
                  key={action}
                  type="button"
                  title={`${action === "reminder" ? action : `Log ${action} with`} ${name}`}
                  aria-label={`${action === "reminder" ? "Schedule a reminder for" : `Log ${action} with`} ${name}`}
                  onClick={(event) =>
                    onQuickAction(contact.id, action, event.currentTarget)
                  }
                  className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-highest hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span
                    className="material-symbols-outlined text-[19px]"
                    aria-hidden="true"
                  >
                    {icon}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
