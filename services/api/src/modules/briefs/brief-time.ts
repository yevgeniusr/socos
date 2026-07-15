const DAY_MS = 24 * 60 * 60 * 1000;

const formatters = new Map<string, Intl.DateTimeFormat>();

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;

  try {
    const formatter = new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatter.format(new Date(0));
    formatters.set(timeZone, formatter);
    return formatter;
  } catch {
    throw new Error("Invalid IANA time zone");
  }
}

function localDateParts(now: Date, timeZone: string): DateParts {
  if (Number.isNaN(now.getTime())) {
    throw new Error("Invalid date");
  }

  const values = new Map(
    formatterFor(timeZone)
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: values.get("year")!,
    month: values.get("month")!,
    day: values.get("day")!,
  };
}

function dateKey({ year, month, day }: DateParts): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function utcOrdinal({ year, month, day }: DateParts): number {
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function assertTimeZone(timeZone: string): void {
  formatterFor(timeZone);
}

export function localDateKey(now: Date, timeZone: string): string {
  return dateKey(localDateParts(now, timeZone));
}

export function dateKeyToUtcDate(key: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new Error("Invalid local date key");

  const [, yearText, monthText, dayText] = match;
  const parts = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
  };
  if (!isCalendarDate(parts.year, parts.month, parts.day)) {
    throw new Error("Invalid local date key");
  }

  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
}

export function daysFromLocalDate(
  now: Date,
  timeZone: string,
  month: number,
  day: number
): { dateKey: string; daysAway: number } {
  if (!isCalendarDate(2000, month, day)) {
    throw new Error("Invalid recurring month and day");
  }

  const today = localDateParts(now, timeZone);
  const todayOrdinal = utcOrdinal(today);
  let year = today.year;

  while (true) {
    if (isCalendarDate(year, month, day)) {
      const occurrence = { year, month, day };
      const occurrenceOrdinal = utcOrdinal(occurrence);
      if (occurrenceOrdinal >= todayOrdinal) {
        return {
          dateKey: dateKey(occurrence),
          daysAway: occurrenceOrdinal - todayOrdinal,
        };
      }
    }
    year += 1;
  }
}
