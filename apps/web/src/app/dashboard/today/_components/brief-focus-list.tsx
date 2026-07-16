import Link from "next/link";

import type { DailyBrief } from "@/lib/cockpit-contracts";
import { healthBandLabel, itemStateLabel } from "../cockpit-view";

function StateBadge({ state }: { state: DailyBrief["people"][number]["state"] }) {
  return (
    <span className="rounded-full border border-outline-variant/40 px-2 py-1 text-[11px] font-bold text-on-surface-variant">
      {itemStateLabel(state)}
    </span>
  );
}

export default function BriefFocusList({ brief }: { brief: DailyBrief }) {
  const events = brief.schemaVersion === "1.1" ? brief.events : [];
  if (!brief.people.length && !brief.dates.length && !events.length) {
    return <p className="py-6 text-sm text-on-surface-variant">No relationship priorities need attention today.</p>;
  }

  return (
    <div className="space-y-7">
      {brief.people.length ? (
        <section aria-labelledby="people-heading">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="people-heading" className="text-lg font-black">People to focus on</h2>
            <span className="text-xs text-on-surface-variant">{brief.people.length} suggested</span>
          </div>
          <ul className="space-y-3">
            {brief.people.map((item) => (
              <li key={item.itemId} className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/dashboard/contacts?contact=${encodeURIComponent(item.contact.id)}`} className="break-words font-black text-on-surface hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                      {item.contact.name}
                    </Link>
                    <p className="mt-1 text-xs font-bold text-tertiary-fixed-dim">
                      {healthBandLabel(item.health.band)} · {item.health.score}/100
                    </p>
                  </div>
                  <StateBadge state={item.state} />
                </div>
                <p className="mt-3 break-words text-sm leading-6 text-on-surface-variant">{item.reason}</p>
                <div className="mt-4 flex flex-wrap gap-2" aria-label={`Actions for ${item.contact.name}`}>
                  <Link href={`/dashboard/contacts?contact=${encodeURIComponent(item.contact.id)}`} className="flex min-h-11 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-black text-on-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-secondary">
                    <span className="material-symbols-outlined text-[19px]" aria-hidden="true">person</span>
                    Open contact
                  </Link>
                  <button type="button" disabled title="Available after action verification" className="min-h-11 rounded-lg border border-outline-variant/30 px-3 text-sm font-bold text-on-surface-variant opacity-60">Keep</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {brief.dates.length ? (
        <section aria-labelledby="dates-heading">
          <h2 id="dates-heading" className="mb-3 text-lg font-black">Important dates</h2>
          <ul className="space-y-3">
            {brief.dates.map((item) => (
              <li key={item.itemId} className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-black">{item.title}</p>
                    <Link href={`/dashboard/contacts?contact=${encodeURIComponent(item.contact.id)}`} className="mt-1 inline-block text-sm text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{item.contact.name}</Link>
                  </div>
                  <StateBadge state={item.state} />
                </div>
                <p className="mt-3 text-sm text-on-surface-variant">{item.daysAway === 0 ? "Today" : `In ${item.daysAway} days`} · {item.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {events.length ? (
        <section aria-labelledby="events-heading">
          <h2 id="events-heading" className="mb-3 text-lg font-black">Possible events</h2>
          <ul className="space-y-3">
            {events.map((item) => (
              <li key={item.itemId} className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-4">
                <div className="flex items-start justify-between gap-3"><p className="break-words font-black">{item.title}</p><StateBadge state={item.state} /></div>
                <p className="mt-2 text-sm text-on-surface-variant">{item.city ?? "Location pending"} · {item.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
