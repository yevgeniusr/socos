"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { apiJson } from "@/lib/api-client";
import { getFocusLoopTarget } from "../contacts/_components/dialog-focus";
import {
  buildEventCatalogQuery,
  certaintyLabel,
  EVENT_KIND_OPTIONS,
  freshnessLabel,
  followActionLabel,
  mergeCatalogPages,
  mergeCatalogFollow,
  rightsLabel,
  sentenceLabel,
  TRUST_TIER_OPTIONS,
  trustLabel,
  type EventCatalogItem,
  type EventCatalogFollowMutation,
  type EventCatalogResponse,
} from "./discover-view";

type Mode = "all" | "following";

interface Filters {
  q: string;
  tags: string;
  kind: string;
  country: string;
  trust: string;
}

const emptyFilters: Filters = {
  q: "",
  tags: "",
  kind: "",
  country: "",
  trust: "",
};

function Icon({ name }: { name: string }) {
  return (
    <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
      {name}
    </span>
  );
}

export default function DiscoverWorkspace() {
  const [mode, setMode] = useState<Mode>("all");
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [items, setItems] = useState<EventCatalogItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<EventCatalogItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailLoadError, setDetailLoadError] = useState("");
  const [detailActionError, setDetailActionError] = useState("");
  const [followMutationSlug, setFollowMutationSlug] = useState<string | null>(
    null
  );
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const selectedSlug = selected?.slug;
  const closeDetail = useCallback(() => {
    detailRequestRef.current += 1;
    setSelected(null);
    setDetailLoading(false);
    setDetailLoadError("");
    setDetailActionError("");
  }, []);

  useEffect(() => {
    if (!selectedSlug) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDetail();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      const target = getFocusLoopTarget(
        controls,
        document.activeElement,
        event.shiftKey
      );
      if (!target) return;
      event.preventDefault();
      target.focus();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      requestAnimationFrame(() => {
        if (previousFocus?.isConnected) previousFocus.focus();
      });
    };
  }, [closeDetail, selectedSlug]);

  const load = useCallback(
    async (cursor?: string) => {
      const requestId = ++listRequestRef.current;
      if (!cursor) setStatus("loading");
      setMessage("");
      try {
        const query = buildEventCatalogQuery({
          q: filters.q,
          tags: filters.tags.split(","),
          kind: filters.kind,
          country: filters.country,
          trust: filters.trust,
          followed: mode === "following" ? true : undefined,
          limit: 24,
          cursor,
        });
        const response = await apiJson<EventCatalogResponse>(
          `/api/event-catalog?${query}`
        );
        if (requestId !== listRequestRef.current) return;
        setItems((current) =>
          cursor ? mergeCatalogPages(current, response.items) : response.items
        );
        setNextCursor(response.nextCursor);
        setStatus("ready");
      } catch (error) {
        if (requestId !== listRequestRef.current) return;
        setMessage(
          error instanceof Error ? error.message : "Event catalog unavailable."
        );
        setStatus("error");
      }
    },
    [filters, mode]
  );

  useEffect(() => {
    void load();
  }, [load]);

  async function openDetail(item: EventCatalogItem) {
    const requestId = ++detailRequestRef.current;
    setSelected(item);
    setDetailLoading(true);
    setDetailLoadError("");
    setDetailActionError("");
    try {
      const detail = await apiJson<EventCatalogItem>(
        `/api/event-catalog/${encodeURIComponent(item.slug)}`
      );
      if (requestId !== detailRequestRef.current) return;
      setSelected(detail);
    } catch {
      if (requestId !== detailRequestRef.current) return;
      setDetailLoadError("Listing details unavailable.");
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }

  async function updateFollow(item: EventCatalogItem) {
    const existing = item.follow;
    const nextStatus = existing?.status === "active" ? "paused" : "active";
    setFollowMutationSlug(item.slug);
    setMessage("");
    if (selectedSlug === item.slug) setDetailActionError("");
    try {
      const mutation = await apiJson<EventCatalogFollowMutation>(
        `/api/event-catalog/${encodeURIComponent(item.slug)}/follow`,
        {
          method: existing ? "PATCH" : "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(existing ? { status: nextStatus } : {}),
        }
      );
      setItems((current) =>
        current.map((entry) => mergeCatalogFollow(entry, mutation))
      );
      setSelected((current) =>
        current ? mergeCatalogFollow(current, mutation) : null
      );
    } catch (error) {
      const actionMessage =
        error instanceof Error ? error.message : "Could not update this follow.";
      setMessage(actionMessage);
      if (selectedSlug === item.slug) setDetailActionError(actionMessage);
    } finally {
      setFollowMutationSlug(null);
    }
  }

  const activeFilterCount = [
    filters.q,
    filters.tags,
    filters.kind,
    filters.country,
    filters.trust,
  ].filter(Boolean).length;

  return (
    <main className="min-h-[calc(100dvh-3.5rem)] bg-surface lg:min-h-screen">
      <header className="border-b border-outline-variant/25 px-4 py-7 sm:px-6 lg:px-10">
        <div className="mx-auto max-w-7xl">
          <p className="text-xs font-bold uppercase text-secondary">
            Event catalog
          </p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <h1 className="text-3xl font-black text-on-surface sm:text-4xl">
              Discover
            </h1>
            <p className="text-sm font-semibold text-on-surface-variant">
              {status === "ready" ? `${items.length} listings` : "Checking catalog"}
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-10">
        <div className="flex w-full border-b border-outline-variant/40 sm:w-auto">
          {(["all", "following"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={`min-h-11 flex-1 border-b-2 px-4 text-sm font-bold capitalize focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary sm:flex-none ${
                mode === value
                  ? "border-primary text-primary"
                  : "border-transparent text-on-surface-variant"
              }`}
            >
              {value}
            </button>
          ))}
        </div>

        <form
          className="mt-5 grid gap-3 border-b border-outline-variant/25 pb-5 sm:grid-cols-2 xl:grid-cols-[minmax(15rem,2fr)_repeat(4,minmax(7rem,1fr))_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            setFilters(draft);
          }}
        >
          <label className="relative min-w-0 sm:col-span-2 xl:col-span-1">
            <span className="sr-only">Search catalog</span>
            <span className="pointer-events-none absolute left-3 top-3 text-on-surface-variant">
              <Icon name="search" />
            </span>
            <input
              value={draft.q}
              onChange={(event) => setDraft({ ...draft, q: event.target.value })}
              placeholder="Search events and calendars"
              className="min-h-11 w-full border border-outline-variant/60 bg-surface-container pl-11 pr-3 text-sm text-on-surface outline-none focus:border-primary"
            />
          </label>
          <input
            aria-label="Tags"
            value={draft.tags}
            onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
            placeholder="Tags"
            className="min-h-11 min-w-0 border border-outline-variant/60 bg-surface-container px-3 text-sm outline-none focus:border-primary"
          />
          <select
            aria-label="Type"
            value={draft.kind}
            onChange={(event) => setDraft({ ...draft, kind: event.target.value })}
            className="min-h-11 min-w-0 border border-outline-variant/60 bg-surface-container px-3 text-sm outline-none focus:border-primary"
          >
            <option value="">All types</option>
            {EVENT_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            aria-label="Country code"
            value={draft.country}
            maxLength={2}
            onChange={(event) =>
              setDraft({ ...draft, country: event.target.value.toUpperCase() })
            }
            placeholder="Country"
            className="min-h-11 min-w-0 border border-outline-variant/60 bg-surface-container px-3 text-sm uppercase outline-none focus:border-primary"
          />
          <select
            aria-label="Trust"
            value={draft.trust}
            onChange={(event) => setDraft({ ...draft, trust: event.target.value })}
            className="min-h-11 min-w-0 border border-outline-variant/60 bg-surface-container px-3 text-sm outline-none focus:border-primary"
          >
            <option value="">All trust levels</option>
            {TRUST_TIER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex min-h-11 flex-1 items-center justify-center bg-primary px-4 text-sm font-bold text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary md:flex-none"
            >
              Apply
            </button>
            {activeFilterCount ? (
              <button
                type="button"
                aria-label="Clear filters"
                title="Clear filters"
                onClick={() => {
                  setDraft(emptyFilters);
                  setFilters(emptyFilters);
                }}
                className="flex size-11 shrink-0 items-center justify-center border border-outline-variant/60 text-on-surface-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Icon name="filter_alt_off" />
              </button>
            ) : null}
          </div>
        </form>

        {status === "loading" ? (
          <p role="status" className="py-12 text-sm text-on-surface-variant">
            Loading event catalog...
          </p>
        ) : null}
        {status === "error" ? (
          <div role="alert" className="py-12">
            <p className="text-sm text-error">{message}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 min-h-11 border border-outline-variant/60 px-4 text-sm font-bold"
            >
              Retry
            </button>
          </div>
        ) : null}
        {status === "ready" && message ? (
          <p role="alert" className="py-4 text-sm font-semibold text-error">
            {message}
          </p>
        ) : null}
        {status === "ready" && items.length === 0 ? (
          <p className="py-12 text-sm text-on-surface-variant">
            No listings match these filters.
          </p>
        ) : null}
        {status === "ready" && items.length ? (
          <div className="divide-y divide-outline-variant/25">
            {items.map((item) => (
              <div
                key={item.slug}
                className="grid w-full min-w-0 gap-3 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
              >
                <button
                  type="button"
                  onClick={() => void openDetail(item)}
                  className="min-w-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="break-words text-base font-extrabold text-on-surface">
                      {item.title}
                    </h2>
                    {item.followed ? (
                      <span className="inline-flex items-center gap-1 bg-secondary/15 px-2 py-1 text-[11px] font-bold uppercase text-secondary">
                        <Icon name="bookmark" />
                        {item.follow?.status === "paused" ? "Paused" : "Following"}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-on-surface-variant">
                    {item.summary}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-on-surface-variant">
                    <span>{trustLabel(item.trustTier)}</span>
                    <span>/</span>
                    <span>{certaintyLabel(item.dateCertainty)}</span>
                    <span>/</span>
                    <span>{freshnessLabel(item.checkedAt, item.freshnessSlaHours)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.tags.slice(0, 6).map((tag) => (
                      <span
                        key={tag}
                        className="border border-outline-variant/50 px-2 py-1 text-[11px] font-bold text-on-surface-variant"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </button>
                <div className="flex items-center justify-between gap-2 md:justify-end">
                  <span className="text-xs font-bold uppercase text-primary">
                    {sentenceLabel(item.kind)}
                  </span>
                  <button
                    type="button"
                    aria-label={`${followActionLabel(item)} ${item.title}`}
                    title={followActionLabel(item)}
                    disabled={followMutationSlug === item.slug}
                    onClick={() => void updateFollow(item)}
                    className="flex size-11 shrink-0 items-center justify-center border border-outline-variant/60 text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                  >
                    <Icon
                      name={
                        item.follow?.status === "active"
                          ? "pause"
                          : item.followed
                            ? "play_arrow"
                            : "bookmark_add"
                      }
                    />
                  </button>
                  <button
                    type="button"
                    aria-label={`View ${item.title}`}
                    title="View details"
                    onClick={() => void openDetail(item)}
                    className="flex size-11 shrink-0 items-center justify-center text-on-surface-variant focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <Icon name="chevron_right" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {status === "ready" && nextCursor ? (
          <button
            type="button"
            onClick={() => void load(nextCursor)}
            className="mt-5 min-h-11 border border-outline-variant/60 px-5 text-sm font-bold text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            Load more
          </button>
        ) : null}
      </div>

      {selected ? (
        <div className="fixed inset-0 z-[70] flex justify-end bg-black/45" role="presentation">
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalog-detail-title"
            tabIndex={-1}
            className="h-full w-full overflow-y-auto bg-surface p-5 shadow-2xl sm:max-w-lg sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase text-secondary">
                  {trustLabel(selected.trustTier)} source
                </p>
                <h2
                  id="catalog-detail-title"
                  className="mt-2 break-words text-2xl font-black text-on-surface"
                >
                  {selected.title}
                </h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label="Close details"
                title="Close details"
                onClick={closeDetail}
                className="flex size-11 shrink-0 items-center justify-center border border-outline-variant/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <Icon name="close" />
              </button>
            </div>
            {detailLoading ? (
              <p role="status" className="mt-8 text-sm text-on-surface-variant">
                Loading details...
              </p>
            ) : detailLoadError ? (
              <div className="mt-8" role="alert">
                <p className="text-sm font-semibold text-error">
                  {detailLoadError}
                </p>
                <button
                  type="button"
                  onClick={() => void openDetail(selected)}
                  className="mt-4 min-h-11 border border-outline-variant/60 px-4 text-sm font-bold text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  Retry
                </button>
              </div>
            ) : (
              <div className="mt-7 space-y-6">
                {detailActionError ? (
                  <p role="alert" className="text-sm font-semibold text-error">
                    {detailActionError}
                  </p>
                ) : null}
                <p className="text-sm leading-6 text-on-surface-variant">
                  {selected.summary}
                </p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-5 text-sm">
                  <div>
                    <dt className="text-xs font-bold uppercase text-on-surface-variant">
                      Date status
                    </dt>
                    <dd className="mt-1 font-bold">
                      {certaintyLabel(selected.dateCertainty)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase text-on-surface-variant">
                      Freshness
                    </dt>
                    <dd className="mt-1 font-bold">
                      {freshnessLabel(selected.checkedAt, selected.freshnessSlaHours)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase text-on-surface-variant">
                      Attribution
                    </dt>
                    <dd className="mt-1 break-words font-bold">
                      {selected.attribution}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold uppercase text-on-surface-variant">
                      Usage rights
                    </dt>
                    <dd className="mt-1 break-words font-bold">
                      {selected.termsUrl ? (
                        <a
                          href={selected.termsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary underline decoration-outline-variant underline-offset-4"
                        >
                          {rightsLabel(selected.rightsBasis)}
                        </a>
                      ) : (
                        rightsLabel(selected.rightsBasis)
                      )}
                    </dd>
                  </div>
                </dl>
                {selected.nextOccurrence ? (
                  <div className="border-l-2 border-primary pl-4">
                    <p className="text-xs font-bold uppercase text-primary">
                      Next occurrence
                    </p>
                    <p className="mt-1 font-extrabold">
                      {selected.nextOccurrence.title}
                    </p>
                    <p className="mt-1 text-sm text-on-surface-variant">
                      {new Date(selected.nextOccurrence.startAt).toLocaleString()}
                    </p>
                  </div>
                ) : null}
                <button
                  type="button"
                  disabled={followMutationSlug === selected.slug}
                  onClick={() => void updateFollow(selected)}
                  className="inline-flex min-h-11 items-center gap-2 bg-primary px-4 text-sm font-bold text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                >
                  <Icon
                    name={
                      selected.follow?.status === "active"
                        ? "pause"
                        : selected.followed
                          ? "play_arrow"
                          : "bookmark_add"
                    }
                  />
                  {followMutationSlug === selected.slug
                    ? "Updating..."
                    : followActionLabel(selected)}
                </button>
                <a
                  href={selected.provenanceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  Source page <Icon name="open_in_new" />
                </a>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
