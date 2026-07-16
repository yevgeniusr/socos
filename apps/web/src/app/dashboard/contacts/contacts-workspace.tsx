"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDashboard } from "../_components/dashboard-shell";
import { apiJson } from "@/lib/api-client";
import type { ContactListResponse } from "@/lib/contact-contracts";
import ContactCreateDialog from "./_components/contact-create-dialog";
import ContactList, {
  type ContactQuickAction,
} from "./_components/contact-list";
import ContactProfile from "./_components/contact-profile";
import {
  buildContactQuery,
  getPageWindow,
  type ContactSortBy,
  type SortOrder,
} from "./contact-query";

const LIMIT = 25;

export default function ContactsWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { showToast } = useDashboard();
  const selectedContactId = searchParams.get("contact");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [label, setLabel] = useState("");
  const [tag, setTag] = useState("");
  const [group, setGroup] = useState("");
  const [sortBy, setSortBy] = useState<ContactSortBy>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<ContactListResponse>({
    contacts: [],
    total: 0,
    offset: 0,
    limit: LIMIT,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [facets, setFacets] = useState({
    labels: [] as string[],
    tags: [] as string[],
    groups: [] as string[],
  });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [profileAction, setProfileAction] = useState<ContactQuickAction | null>(
    null
  );
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const normalized = searchInput.trim();
      setSearch((current) => {
        if (current !== normalized) setOffset(0);
        return normalized;
      });
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      apiJson<string[]>("/api/contacts/labels"),
      apiJson<string[]>("/api/contacts/tags"),
      apiJson<string[]>("/api/contacts/groups"),
    ]).then(([labelsResult, tagsResult, groupsResult]) => {
      if (!active) return;
      setFacets({
        labels: labelsResult.status === "fulfilled" ? labelsResult.value : [],
        tags: tagsResult.status === "fulfilled" ? tagsResult.value : [],
        groups: groupsResult.status === "fulfilled" ? groupsResult.value : [],
      });
    });
    return () => {
      active = false;
    };
  }, []);

  const query = useMemo(
    () =>
      buildContactQuery({
        search,
        label,
        tag,
        group,
        offset,
        limit: LIMIT,
        sortBy,
        sortOrder,
      }),
    [group, label, offset, search, sortBy, sortOrder, tag]
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    void apiJson<ContactListResponse>(`/api/contacts?${query}`, {
      signal: controller.signal,
    })
      .then((response) => {
        if (controller.signal.aborted) return;
        const page = getPageWindow({
          total: response.total,
          offset,
          limit: LIMIT,
        });
        const boundedOffset = page.page > 0 ? (page.page - 1) * LIMIT : 0;
        if (boundedOffset !== offset) {
          setOffset(boundedOffset);
          return;
        }
        setResult(response);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error ? reason.message : "Could not load contacts."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [offset, query, refreshVersion]);

  const refreshList = useCallback(async () => {
    setRefreshVersion((version) => version + 1);
  }, []);

  const openProfile = useCallback(
    (
      contactId: string,
      trigger: HTMLButtonElement,
      action: ContactQuickAction | null = null
    ) => {
      lastTriggerRef.current = trigger;
      setProfileAction(action);
      const params = new URLSearchParams(searchParams.toString());
      params.set("contact", contactId);
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams]
  );

  const closeProfile = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("contact");
    const queryString = params.toString();
    router.push(queryString ? `${pathname}?${queryString}` : pathname);
    setProfileAction(null);
    window.requestAnimationFrame(() => lastTriggerRef.current?.focus());
  }, [pathname, router, searchParams]);

  function updateFacet(setter: (value: string) => void, value: string) {
    setter(value);
    setOffset(0);
  }

  const page = getPageWindow({ total: result.total, offset, limit: LIMIT });

  return (
    <main className="mx-auto min-w-0 max-w-[1180px] px-3 py-5 sm:px-6 sm:py-7 xl:px-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase text-secondary">
            Personal workspace
          </p>
          <h1 className="mt-1 text-2xl font-black sm:text-3xl">Contacts</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Showing {page.start}-{page.end} of {result.total}
          </p>
        </div>
        <button
          ref={addButtonRef}
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-black text-on-primary hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary"
        >
          <span
            className="material-symbols-outlined text-[20px]"
            aria-hidden="true"
          >
            person_add
          </span>
          Add contact
        </button>
      </header>

      <section
        aria-label="Contact filters"
        className="mb-5 grid min-w-0 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_180px_160px_160px_190px]"
      >
        <label className="relative min-w-0">
          <span className="sr-only">Search contacts</span>
          <span
            className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant"
            aria-hidden="true"
          >
            search
          </span>
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search contacts"
            className="min-h-11 w-full min-w-0 rounded-lg border border-outline-variant/30 bg-surface-container-low pl-10 pr-3 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none"
          />
        </label>
        <label>
          <span className="sr-only">Filter by label</span>
          <select
            aria-label="Filter by label"
            value={label}
            onChange={(event) => updateFacet(setLabel, event.target.value)}
            className="min-h-11 w-full min-w-0 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 text-sm text-on-surface focus:border-primary focus:outline-none"
          >
            <option value="">All labels</option>
            {facets.labels.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by tag</span>
          <select
            aria-label="Filter by tag"
            value={tag}
            onChange={(event) => updateFacet(setTag, event.target.value)}
            className="min-h-11 w-full min-w-0 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 text-sm text-on-surface focus:border-primary focus:outline-none"
          >
            <option value="">All tags</option>
            {facets.tags.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Filter by group</span>
          <select
            aria-label="Filter by group"
            value={group}
            onChange={(event) => updateFacet(setGroup, event.target.value)}
            className="min-h-11 w-full min-w-0 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 text-sm text-on-surface focus:border-primary focus:outline-none"
          >
            <option value="">All groups</option>
            {facets.groups.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">Sort contacts</span>
          <select
            aria-label="Sort contacts"
            value={`${sortBy}:${sortOrder}`}
            onChange={(event) => {
              const [nextSort, nextOrder] = event.target.value.split(":") as [
                ContactSortBy,
                SortOrder,
              ];
              setSortBy(nextSort);
              setSortOrder(nextOrder);
              setOffset(0);
            }}
            className="min-h-11 w-full min-w-0 rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 text-sm text-on-surface focus:border-primary focus:outline-none"
          >
            <option value="createdAt:desc">Newest added</option>
            <option value="firstName:asc">First name</option>
            <option value="lastContactedAt:desc">Recently contacted</option>
            <option value="relationshipScore:desc">Relationship score</option>
            <option value="nextReminderAt:asc">Next reminder</option>
          </select>
        </label>
      </section>

      <ContactList
        contacts={result.contacts}
        loading={loading}
        error={error}
        onRetry={() => setRefreshVersion((version) => version + 1)}
        onSelect={(contactId, trigger) => openProfile(contactId, trigger)}
        onQuickAction={(contactId, action, trigger) =>
          openProfile(contactId, trigger, action)
        }
      />

      <footer className="mt-5 flex items-center justify-between gap-3 border-t border-outline-variant/20 pt-4">
        <p className="min-w-28 text-xs font-semibold text-on-surface-variant">
          Page {page.page || 0} of {page.pageCount}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!page.hasPrevious || loading}
            onClick={() => setOffset((current) => Math.max(0, current - LIMIT))}
            className="flex min-h-11 min-w-24 items-center justify-center gap-1 rounded-lg border border-outline-variant/30 px-3 text-sm font-bold text-on-surface-variant disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span
              className="material-symbols-outlined text-[19px]"
              aria-hidden="true"
            >
              chevron_left
            </span>
            Previous
          </button>
          <button
            type="button"
            disabled={!page.hasNext || loading}
            onClick={() => setOffset((current) => current + LIMIT)}
            className="flex min-h-11 min-w-24 items-center justify-center gap-1 rounded-lg bg-surface-container-high px-3 text-sm font-bold text-primary disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            Next
            <span
              className="material-symbols-outlined text-[19px]"
              aria-hidden="true"
            >
              chevron_right
            </span>
          </button>
        </div>
      </footer>

      <ContactCreateDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          window.requestAnimationFrame(() => addButtonRef.current?.focus());
        }}
        onCreated={async () => {
          setOffset(0);
          await refreshList();
          showToast("Contact created.", "success");
        }}
      />
      {selectedContactId ? (
        <ContactProfile
          contactId={selectedContactId}
          initialAction={profileAction}
          onClose={closeProfile}
          onMutation={refreshList}
        />
      ) : null}
    </main>
  );
}
