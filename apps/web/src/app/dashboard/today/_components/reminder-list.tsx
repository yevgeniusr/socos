import type { UpcomingRemindersResponse } from "@/lib/cockpit-contracts";
import { formatBriefDate } from "../cockpit-view";

export default function ReminderList({ data, timeZone, busyId, errors, onComplete }: { data: UpcomingRemindersResponse; timeZone: string; busyId: string | null; errors: Record<string, string>; onComplete: (id: string) => Promise<void> }) {
  return (
    <section aria-labelledby="reminders-heading" className="border-t border-outline-variant/25 pt-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="reminders-heading" className="text-base font-black">Upcoming reminders</h2>
        <span className="text-xs text-on-surface-variant">{data.stats.thisWeek} this week</span>
      </div>
      {data.reminders.length ? (
        <ul className="mt-3 divide-y divide-outline-variant/20">
          {data.reminders.slice(0, 5).map((reminder) => (
            <li key={reminder.id} className="py-3 first:pt-0">
              <p className="break-words text-sm font-bold">{reminder.title}</p>
              <p className="mt-1 text-xs text-on-surface-variant">
                {[reminder.contact.firstName, reminder.contact.lastName].filter(Boolean).join(" ")} · {formatBriefDate(reminder.scheduledAt, timeZone)}
              </p>
              <button type="button" disabled={busyId === reminder.id} onClick={() => void onComplete(reminder.id)} className="mt-2 min-h-11 rounded-lg border border-outline-variant/40 px-3 text-xs font-bold text-on-surface-variant disabled:opacity-60">{busyId === reminder.id ? "Completing..." : "Complete"}</button>
              {errors[reminder.id] ? <p role="alert" className="mt-1 text-xs text-error">{errors[reminder.id]}</p> : null}
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-sm text-on-surface-variant">No upcoming reminders.</p>}
    </section>
  );
}
