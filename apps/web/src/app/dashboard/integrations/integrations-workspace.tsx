"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import EventDiscoveryPanel from "./_components/event-discovery-panel";
import GoogleCalendarPanel from "./_components/google-calendar-panel";
import PixelLocationPanel from "./_components/pixel-location-panel";
import {
  calendarAccessSummary,
  parseCalendarResult,
  type CalendarAccessSummary,
} from "./integration-view";

export default function IntegrationsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const calendarResult = parseCalendarResult(searchParams.get("calendar"));
  const [calendarReceipt, setCalendarReceipt] = useState<string | null>(null);
  const [calendarRefresh, setCalendarRefresh] = useState(0);
  const [calendarSummary, setCalendarSummary] = useState<CalendarAccessSummary>(
    () => calendarAccessSummary({ status: "loading" })
  );

  const updateCalendarSummary = useCallback((next: CalendarAccessSummary) => {
    setCalendarSummary((current) =>
      current.state === next.state &&
      current.accessLabel === next.accessLabel &&
      current.sourceLabel === next.sourceLabel
        ? current
        : next
    );
  }, []);

  useEffect(() => {
    if (!calendarResult) return;

    setCalendarReceipt(
      calendarResult === "connected"
        ? "Google Calendar connected. Calendar data is refreshing."
        : "Google Calendar connection failed. Try connecting again."
    );
    setCalendarRefresh((value) => value + 1);
    router.replace("/dashboard/integrations");
  }, [calendarResult, router]);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-6 sm:px-6 sm:pb-8">
      <div
        role="status"
        aria-label="Calendar access"
        aria-live="polite"
        className="sticky top-14 z-20 -mx-4 flex min-w-0 items-center gap-3 border-y border-outline-variant/30 bg-surface px-4 py-3 sm:-mx-6 sm:px-6 lg:top-0 lg:mx-0 lg:border-x"
      >
        <span
          className={`material-symbols-outlined shrink-0 text-[21px] ${
            calendarSummary.state === "active"
              ? "text-secondary"
              : calendarSummary.state === "review" ||
                  calendarSummary.state === "error"
                ? "text-error"
                : "text-on-surface-variant"
          }`}
          aria-hidden="true"
        >
          {calendarSummary.state === "active"
            ? "lock"
            : calendarSummary.state === "review" ||
                calendarSummary.state === "error"
              ? "warning"
              : "calendar_month"}
        </span>
        <div className="min-w-0 sm:flex sm:flex-1 sm:items-baseline sm:justify-between sm:gap-4">
          <p className="break-words text-sm font-extrabold text-on-surface">
            {calendarSummary.accessLabel}
          </p>
          <p className="break-words text-xs text-on-surface-variant">
            {calendarSummary.sourceLabel}
          </p>
        </div>
      </div>

      <div className="mb-8 border-b border-outline-variant/30 pb-5 pt-6 sm:pt-8">
        <p className="mb-1 text-xs font-bold uppercase text-secondary">
          Activation workspace
        </p>
        <h1 className="text-2xl font-black text-on-surface sm:text-3xl">
          Integrations
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-on-surface-variant">
          Connect planning, current context, and certified event sources. Each
          integration stays independent when another is unavailable.
        </p>
      </div>

      <div aria-live="polite" aria-atomic="true">
        {calendarReceipt ? (
          <p
            role="status"
            className="mb-5 border-l-2 border-secondary bg-surface-container-low px-4 py-3 text-sm text-on-surface"
          >
            {calendarReceipt}
          </p>
        ) : null}
      </div>

      <div className="space-y-6">
        <GoogleCalendarPanel
          refreshToken={calendarRefresh}
          onSummaryChange={updateCalendarSummary}
        />
        <PixelLocationPanel />
        <EventDiscoveryPanel />
      </div>
    </main>
  );
}
