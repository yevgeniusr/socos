"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import EventDiscoveryPanel from "./_components/event-discovery-panel";
import GoogleCalendarPanel from "./_components/google-calendar-panel";
import PixelLocationPanel from "./_components/pixel-location-panel";
import { parseCalendarResult } from "./integration-view";

export default function IntegrationsWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const calendarResult = parseCalendarResult(searchParams.get("calendar"));
  const [calendarReceipt, setCalendarReceipt] = useState<string | null>(null);
  const [calendarRefresh, setCalendarRefresh] = useState(0);

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
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-8 border-b border-outline-variant/30 pb-5">
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
        <GoogleCalendarPanel refreshToken={calendarRefresh} />
        <PixelLocationPanel />
        <EventDiscoveryPanel />
      </div>
    </main>
  );
}
