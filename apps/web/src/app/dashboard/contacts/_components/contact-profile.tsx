"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useDashboard } from "../../_components/dashboard-shell";
import { ApiError, apiJson } from "@/lib/api-client";
import type { ContactDetail, InteractionType } from "@/lib/contact-contracts";
import ContactEditor from "./contact-editor";
import type { ContactQuickAction } from "./contact-list";
import InteractionForm from "./interaction-form";
import ReminderForm from "./reminder-form";

function displayName(contact: ContactDetail) {
  return [contact.firstName, contact.middleName, contact.lastName]
    .filter(Boolean)
    .join(" ");
}

function formatDate(value: string | null, includeTime = false) {
  if (!value) return "Not set";
  const options: Intl.DateTimeFormatOptions = includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" };
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
}

function safeHttpUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-outline-variant/20 py-5">
      <h3 className="mb-3 text-xs font-black uppercase text-on-surface-variant">
        {title}
      </h3>
      {children}
    </section>
  );
}

export default function ContactProfile({
  contactId,
  initialAction,
  onClose,
  onMutation,
}: {
  contactId: string;
  initialAction: ContactQuickAction | null;
  onClose: () => void;
  onMutation: () => Promise<void>;
}) {
  const { showToast, refreshDashboardStats, refreshUpcomingReminders } =
    useDashboard();
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [activeForm, setActiveForm] = useState<
    "interaction" | "reminder" | null
  >(null);
  const [interactionType, setInteractionType] =
    useState<InteractionType>("note");
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const detail = await apiJson<ContactDetail>(
        `/api/contacts/${encodeURIComponent(contactId)}`
      );
      setContact(detail);
    } catch (reason) {
      const message =
        reason instanceof Error
          ? reason.message
          : "Could not load the contact.";
      if (reason instanceof ApiError && reason.status === 404) {
        showToast("That contact is no longer available.", "error");
        onClose();
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [contactId, onClose, showToast]);

  useEffect(() => {
    setContact(null);
    setEditing(false);
    setActionError("");
    if (initialAction === "reminder") {
      setActiveForm("reminder");
    } else if (initialAction === "call" || initialAction === "message") {
      setInteractionType(initialAction);
      setActiveForm("interaction");
    } else {
      setActiveForm(null);
      setInteractionType("note");
    }
    void loadDetail();
  }, [contactId, initialAction, loadDetail]);

  useEffect(() => {
    closeButtonRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function afterProfileMutation() {
    await Promise.allSettled([loadDetail(), onMutation()]);
    setEditing(false);
    showToast("Contact updated.", "success");
  }

  async function afterInteraction() {
    await Promise.allSettled([
      loadDetail(),
      onMutation(),
      refreshDashboardStats(),
    ]);
    showToast("Interaction logged.", "success");
  }

  async function afterReminder() {
    await Promise.allSettled([
      loadDetail(),
      onMutation(),
      refreshUpcomingReminders(),
    ]);
    showToast("Reminder created.", "success");
  }

  async function completeReminder(reminderId: string) {
    setCompletingId(reminderId);
    setActionError("");
    try {
      await apiJson(
        `/api/reminders/${encodeURIComponent(reminderId)}/complete`,
        { method: "PUT" }
      );
      await Promise.allSettled([
        loadDetail(),
        onMutation(),
        refreshUpcomingReminders(),
      ]);
      showToast("Reminder completed.", "success");
    } catch (reason) {
      setActionError(
        reason instanceof Error
          ? reason.message
          : "Could not complete the reminder."
      );
    } finally {
      setCompletingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[60]">
      <div
        className="absolute inset-0 bg-black/65"
        onMouseDown={onClose}
        aria-hidden="true"
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Contact profile"
        className="absolute inset-0 flex min-w-0 flex-col overflow-hidden bg-surface shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[min(720px,calc(100vw-2rem))] sm:border-l sm:border-outline-variant/30"
      >
        <header className="flex min-h-16 shrink-0 items-center justify-between border-b border-outline-variant/20 px-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase text-secondary">
              Contact workspace
            </p>
            <h2 className="truncate text-lg font-black">
              {contact ? displayName(contact) : "Contact profile"}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {contact && !editing ? (
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label="Edit contact"
                title="Edit contact"
                className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  edit
                </span>
              </button>
            ) : null}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label="Close profile"
              title="Close profile"
              className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                close
              </span>
            </button>
          </div>
        </header>
        <div className="min-w-0 flex-1 overflow-y-auto px-4 sm:px-6">
          {loading && !contact ? (
            <div
              className="py-16 text-center text-sm text-on-surface-variant"
              aria-busy="true"
            >
              Loading profile...
            </div>
          ) : null}
          {error ? (
            <div
              role="alert"
              className="my-6 rounded-lg border border-error/40 bg-error-container/30 p-5 text-center"
            >
              <p className="text-sm text-error">{error}</p>
              <button
                type="button"
                onClick={() => void loadDetail()}
                className="mt-4 min-h-11 rounded-lg bg-error px-4 text-sm font-bold text-on-error"
              >
                Try again
              </button>
            </div>
          ) : null}
          {contact && editing ? (
            <ContactEditor
              key={contact.updatedAt}
              contact={contact}
              onSuccess={afterProfileMutation}
              onCancel={() => setEditing(false)}
            />
          ) : null}
          {contact && !editing ? (
            <div className="pb-8">
              <div className="flex min-w-0 items-center gap-4 py-6">
                <div
                  aria-hidden="true"
                  className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-container-highest bg-cover bg-center text-lg font-black text-primary"
                  style={
                    safeHttpUrl(contact.photo)
                      ? {
                          backgroundImage: `url(${JSON.stringify(safeHttpUrl(contact.photo))})`,
                        }
                      : undefined
                  }
                >
                  {safeHttpUrl(contact.photo)
                    ? null
                    : `${contact.firstName[0] ?? ""}${contact.lastName?.[0] ?? ""}`.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="break-words text-2xl font-black">
                    {displayName(contact)}
                  </h2>
                  <p className="break-words text-sm text-on-surface-variant">
                    {[contact.jobTitle, contact.company]
                      .filter(Boolean)
                      .join(" at ") ||
                      contact.nickname ||
                      "No work details"}
                  </p>
                </div>
                <div className="shrink-0 text-center">
                  <p className="text-2xl font-black text-secondary">
                    {contact.relationshipScore}
                  </p>
                  <p className="text-[10px] uppercase text-on-surface-variant">
                    Score
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 pb-5">
                <button
                  type="button"
                  onClick={() => {
                    setInteractionType("call");
                    setActiveForm("interaction");
                  }}
                  className="min-h-11 rounded-lg bg-surface-container-high px-2 text-xs font-bold text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span
                    className="material-symbols-outlined mr-1 text-[18px]"
                    aria-hidden="true"
                  >
                    call
                  </span>
                  Call
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setInteractionType("message");
                    setActiveForm("interaction");
                  }}
                  className="min-h-11 rounded-lg bg-surface-container-high px-2 text-xs font-bold text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span
                    className="material-symbols-outlined mr-1 text-[18px]"
                    aria-hidden="true"
                  >
                    chat
                  </span>
                  Message
                </button>
                <button
                  type="button"
                  onClick={() => setActiveForm("reminder")}
                  className="min-h-11 rounded-lg bg-surface-container-high px-2 text-xs font-bold text-tertiary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span
                    className="material-symbols-outlined mr-1 text-[18px]"
                    aria-hidden="true"
                  >
                    notifications_active
                  </span>
                  Remind
                </button>
              </div>
              {activeForm === "interaction" ? (
                <InteractionForm
                  key={interactionType}
                  contactId={contact.id}
                  initialType={interactionType}
                  onSuccess={afterInteraction}
                  onCancel={() => setActiveForm(null)}
                />
              ) : null}
              {activeForm === "reminder" ? (
                <ReminderForm
                  contactId={contact.id}
                  onSuccess={afterReminder}
                  onCancel={() => setActiveForm(null)}
                />
              ) : null}

              <Section title="Relationship">
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-[10px] uppercase text-on-surface-variant">
                      Importance
                    </p>
                    <p className="font-bold">{contact.importance} / 5</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-on-surface-variant">
                      Cadence
                    </p>
                    <p className="font-bold">
                      {contact.preferredCadenceDays} days
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-on-surface-variant">
                      Last contact
                    </p>
                    <p className="font-bold">
                      {formatDate(contact.lastContactedAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase text-on-surface-variant">
                      Next reminder
                    </p>
                    <p className="font-bold">
                      {formatDate(contact.nextReminderAt)}
                    </p>
                  </div>
                </div>
                {contact.bio ? (
                  <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-on-surface-variant">
                    {contact.bio}
                  </p>
                ) : null}
              </Section>
              <Section title="Labels and groups">
                <div className="flex flex-wrap gap-1.5">
                  {[
                    ...contact.labels.map((value) => ["label", value] as const),
                    ...contact.tags.map((value) => ["tag", value] as const),
                    ...contact.groups.map((value) => ["group", value] as const),
                  ].map(([kind, value]) => (
                    <span
                      key={`${kind}-${value}`}
                      className={`rounded px-2 py-1 text-xs font-bold ${kind === "label" ? "bg-primary/10 text-primary" : kind === "group" ? "bg-secondary/10 text-secondary" : "bg-surface-container-high text-on-surface-variant"}`}
                    >
                      {value}
                    </span>
                  ))}
                </div>
              </Section>
              <Section title="Contact methods">
                <div className="space-y-2">
                  {contact.contactFields.length ? (
                    contact.contactFields.map((field) => {
                      const href =
                        field.type === "email"
                          ? `mailto:${field.value}`
                          : field.type === "phone"
                            ? `tel:${field.value}`
                            : field.type === "website"
                              ? safeHttpUrl(field.value)
                              : null;
                      return (
                        <div
                          key={field.id}
                          className="flex min-w-0 items-center gap-3 rounded-lg bg-surface-container-low px-3 py-2"
                        >
                          <span
                            className="material-symbols-outlined text-[19px] text-primary"
                            aria-hidden="true"
                          >
                            {field.type === "email"
                              ? "mail"
                              : field.type === "phone"
                                ? "call"
                                : field.type === "address"
                                  ? "location_on"
                                  : "link"}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[10px] uppercase text-on-surface-variant">
                              {field.label || field.type}
                              {field.isPrimary ? " - primary" : ""}
                            </p>
                            {href ? (
                              <a
                                href={href}
                                className="break-all text-sm font-semibold text-primary hover:underline"
                              >
                                {field.value}
                              </a>
                            ) : (
                              <p className="break-all text-sm font-semibold">
                                {field.value}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-sm text-on-surface-variant">
                      No contact methods saved.
                    </p>
                  )}
                </div>
              </Section>
              <Section title="Important dates">
                <dl className="grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-[10px] uppercase text-on-surface-variant">
                      Birthday
                    </dt>
                    <dd className="font-semibold">
                      {formatDate(contact.birthday)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-on-surface-variant">
                      Anniversary
                    </dt>
                    <dd className="font-semibold">
                      {formatDate(contact.anniversary)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-on-surface-variant">
                      First met
                    </dt>
                    <dd className="font-semibold">
                      {formatDate(contact.firstMetDate)}
                    </dd>
                  </div>
                </dl>
                {contact.firstMetContext ? (
                  <p className="mt-3 text-sm text-on-surface-variant">
                    {contact.firstMetContext}
                  </p>
                ) : null}
              </Section>
              {contact.socialLinks &&
              Object.keys(contact.socialLinks).length ? (
                <Section title="Social links">
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(contact.socialLinks).map(([name, href]) => (
                      <a
                        key={name}
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="min-h-10 rounded-lg bg-surface-container-high px-3 py-2 text-sm font-bold capitalize text-primary hover:underline"
                      >
                        {name}
                      </a>
                    ))}
                  </div>
                </Section>
              ) : null}
              <Section
                title={`Interaction timeline (${contact._count.interactions})`}
              >
                <div className="space-y-3">
                  {contact.interactions.length ? (
                    contact.interactions.map((interaction) => (
                      <article
                        key={interaction.id}
                        className="border-l-2 border-secondary pl-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-bold">
                            {interaction.title || interaction.type}
                          </p>
                          <time className="shrink-0 text-[10px] text-on-surface-variant">
                            {formatDate(interaction.occurredAt, true)}
                          </time>
                        </div>
                        {interaction.content ? (
                          <p className="mt-1 whitespace-pre-wrap text-sm text-on-surface-variant">
                            {interaction.content}
                          </p>
                        ) : null}
                      </article>
                    ))
                  ) : (
                    <p className="text-sm text-on-surface-variant">
                      No interactions logged.
                    </p>
                  )}
                </div>
              </Section>
              <Section
                title={`Pending reminders (${contact.reminders.length})`}
              >
                <div className="space-y-2">
                  {contact.reminders.length ? (
                    contact.reminders.map((reminder) => (
                      <div
                        key={reminder.id}
                        className="flex min-w-0 items-center gap-3 rounded-lg bg-surface-container-low px-3 py-3"
                      >
                        <span
                          className="material-symbols-outlined shrink-0 text-tertiary"
                          aria-hidden="true"
                        >
                          notifications_active
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-bold">
                            {reminder.title}
                          </p>
                          <p className="text-xs text-on-surface-variant">
                            {formatDate(reminder.scheduledAt, true)}
                          </p>
                          {reminder.description ? (
                            <p className="mt-1 break-words text-xs text-on-surface-variant">
                              {reminder.description}
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          disabled={completingId === reminder.id}
                          onClick={() => void completeReminder(reminder.id)}
                          aria-label={`Complete reminder ${reminder.title}`}
                          title="Complete reminder"
                          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-secondary hover:bg-secondary/10 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        >
                          <span
                            className="material-symbols-outlined"
                            aria-hidden="true"
                          >
                            check_circle
                          </span>
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-on-surface-variant">
                      No pending reminders.
                    </p>
                  )}
                </div>
                {actionError ? (
                  <p role="alert" className="mt-3 text-sm text-error">
                    {actionError}
                  </p>
                ) : null}
              </Section>
              <Section title="Source">
                <p className="text-xs text-on-surface-variant">
                  {contact.sourceSystem
                    ? `Imported from ${contact.sourceSystem}${contact.importedAt ? ` on ${formatDate(contact.importedAt)}` : ""}`
                    : `Created in Socos on ${formatDate(contact.createdAt)}`}
                </p>
              </Section>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
