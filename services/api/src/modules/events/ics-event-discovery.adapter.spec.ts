import { IcsEventDiscoveryAdapter } from "./ics-event-discovery.adapter.js";

const NOW = new Date("2026-07-16T00:00:00.000Z");

function calendar(components: string): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Socos synthetic fixture//EN",
    components.trim(),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

describe("IcsEventDiscoveryAdapter", () => {
  const adapter = new IcsEventDiscoveryAdapter();

  it("accepts a valid empty calendar as a successful full feed", () => {
    expect(adapter.parse(calendar(""), NOW)).toEqual([]);
  });

  it("normalizes one UTC event and locks the canonical identity", () => {
    const result = adapter.parse(
      calendar(`
BEGIN:VEVENT
UID:event-1
DTSTAMP:20260715T120000Z
LAST-MODIFIED:20260715T130000Z
DTSTART:20260717T180000Z
DTEND:20260717T200000Z
SUMMARY:${"  Community cafe meetup  "}
DESCRIPTION:A public gathering
LOCATION:Main Hall
URL:https://events.example.com/items/1
GEO:25.2048;55.2708
CATEGORIES:community,learning
END:VEVENT`),
      NOW
    );

    expect(result).toEqual([
      expect.objectContaining({
        providerEventId: "event-1:2026-07-17T18:00:00.000Z",
        canonicalIdentity: "event-1:2026-07-17T18:00:00.000Z",
        title: "Community cafe meetup",
        startAt: new Date("2026-07-17T18:00:00.000Z"),
        endAt: new Date("2026-07-17T20:00:00.000Z"),
        latitude: 25.2048,
        longitude: 55.2708,
        tags: ["community", "learning"],
        status: "scheduled",
        sourceUpdatedAt: new Date("2026-07-15T13:00:00.000Z"),
        expiresAt: new Date("2026-07-17T20:00:00.000Z"),
      }),
    ]);
  });

  it("preserves exact nonblank UIDs when grouping and building identities", () => {
    const result = adapter.parse(
      calendar(`
BEGIN:VEVENT
UID:abc
DTSTAMP:20260715T120000Z
DTSTART:20260717T180000Z
DTEND:20260717T190000Z
SUMMARY:Exact UID
END:VEVENT
BEGIN:VEVENT
UID:${" abc "}
DTSTAMP:20260715T120000Z
DTSTART:20260717T180000Z
DTEND:20260717T190000Z
SUMMARY:Whitespace UID
END:VEVENT`),
      NOW
    );

    expect(result.map((event) => event.providerEventId)).toEqual([
      " abc :2026-07-17T18:00:00.000Z",
      "abc:2026-07-17T18:00:00.000Z",
    ]);
    expect(result.map((event) => event.canonicalIdentity)).toEqual([
      " abc :2026-07-17T18:00:00.000Z",
      "abc:2026-07-17T18:00:00.000Z",
    ]);
  });

  it("expands recurrence, moves exceptions, and represents EXDATE cancellation", () => {
    const result = adapter.parse(
      calendar(`
BEGIN:VEVENT
UID:daily-1
DTSTAMP:20260715T120000Z
DTSTART:20260716T100000Z
DTEND:20260716T110000Z
RRULE:FREQ=DAILY;COUNT=4
EXDATE:20260718T100000Z
SUMMARY:Daily social hour
END:VEVENT
BEGIN:VEVENT
UID:daily-1
RECURRENCE-ID:20260717T100000Z
DTSTAMP:20260715T130000Z
DTSTART:20260717T120000Z
DTEND:20260717T133000Z
SUMMARY:Moved social hour
END:VEVENT`),
      NOW
    );

    expect(
      result.map(({ providerEventId, startAt, status }) => ({
        providerEventId,
        startAt: startAt.toISOString(),
        status,
      }))
    ).toEqual([
      {
        providerEventId: "daily-1:2026-07-16T10:00:00.000Z",
        startAt: "2026-07-16T10:00:00.000Z",
        status: "scheduled",
      },
      {
        providerEventId: "daily-1:2026-07-17T10:00:00.000Z",
        startAt: "2026-07-17T12:00:00.000Z",
        status: "scheduled",
      },
      {
        providerEventId: "daily-1:2026-07-18T10:00:00.000Z",
        startAt: "2026-07-18T10:00:00.000Z",
        status: "cancelled",
      },
      {
        providerEventId: "daily-1:2026-07-19T10:00:00.000Z",
        startAt: "2026-07-19T10:00:00.000Z",
        status: "scheduled",
      },
    ]);
  });

  it("derives timing for a cancelled exception without DTSTART", () => {
    const result = adapter.parse(
      calendar(`
BEGIN:VEVENT
UID:cancel-1
DTSTAMP:20260715T120000Z
DTSTART:20260716T100000Z
DTEND:20260716T110000Z
RRULE:FREQ=DAILY;COUNT=2
SUMMARY:Daily event
END:VEVENT
BEGIN:VEVENT
UID:cancel-1
RECURRENCE-ID:20260717T100000Z
DTSTAMP:20260715T130000Z
STATUS:CANCELLED
SUMMARY:Cancelled event
END:VEVENT`),
      NOW
    );

    expect(result[1]).toEqual(
      expect.objectContaining({
        providerEventId: "cancel-1:2026-07-17T10:00:00.000Z",
        startAt: new Date("2026-07-17T10:00:00.000Z"),
        endAt: new Date("2026-07-17T11:00:00.000Z"),
        status: "cancelled",
      })
    );
  });

  it("uses date-only recurrence identities for all-day events", () => {
    const result = adapter.parse(
      calendar(`
BEGIN:VEVENT
UID:all-day
DTSTAMP:20260715T120000Z
DTSTART;VALUE=DATE:20260717
DTEND;VALUE=DATE:20260718
RRULE:FREQ=DAILY;COUNT=2
SUMMARY:Festival
END:VEVENT`),
      NOW
    );

    expect(result.map((event) => event.providerEventId)).toEqual([
      "all-day:2026-07-17",
      "all-day:2026-07-18",
    ]);
  });

  it("uses an embedded VTIMEZONE and rejects an unknown TZID", () => {
    const withZone = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Socos synthetic fixture//EN",
      "BEGIN:VTIMEZONE",
      "TZID:Asia/Dubai",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:+0400",
      "TZOFFSETTO:+0400",
      "TZNAME:+04",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:zoned",
      "DTSTAMP:20260715T120000Z",
      "DTSTART;TZID=Asia/Dubai:20260717T100000",
      "DTEND;TZID=Asia/Dubai:20260717T110000",
      "SUMMARY:Zoned event",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    expect(adapter.parse(withZone, NOW)[0]).toEqual(
      expect.objectContaining({
        startAt: new Date("2026-07-17T06:00:00.000Z"),
        timeZone: "Asia/Dubai",
      })
    );

    const unknown = calendar(`
BEGIN:VEVENT
UID:unknown-zone
DTSTART;TZID=Secret/Unknown:20260717T100000
DTEND;TZID=Secret/Unknown:20260717T110000
SUMMARY:Unknown
END:VEVENT`);
    expect(() => adapter.parse(unknown, NOW)).toThrow(
      "Event feed parse failed"
    );
  });

  it("marks every expanded instance cancelled when the master is cancelled", () => {
    const result = adapter.parse(
      calendar(`
BEGIN:VEVENT
UID:cancelled-series
DTSTAMP:20260715T120000Z
DTSTART:20260716T100000Z
DTEND:20260716T110000Z
RRULE:FREQ=DAILY;COUNT=2
STATUS:CANCELLED
SUMMARY:Cancelled series
END:VEVENT`),
      NOW
    );

    expect(result).toHaveLength(2);
    expect(result.every((event) => event.status === "cancelled")).toBe(true);
  });

  it("inherits public fields for a moved exception and includes moves into the window", () => {
    const result = adapter.parse(
      calendar(`
BEGIN:VEVENT
UID:moved-in
DTSTAMP:20260715T120000Z
DTSTART:20260731T100000Z
DTEND:20260731T110000Z
RRULE:FREQ=DAILY;COUNT=2
SUMMARY:Inherited title
LOCATION:Inherited venue
END:VEVENT
BEGIN:VEVENT
UID:moved-in
RECURRENCE-ID:20260731T100000Z
DTSTAMP:20260715T130000Z
DTSTART:20260717T120000Z
DTEND:20260717T130000Z
END:VEVENT`),
      NOW
    );

    expect(result).toEqual([
      expect.objectContaining({
        providerEventId: "moved-in:2026-07-31T10:00:00.000Z",
        title: "Inherited title",
        venueName: "Inherited venue",
        startAt: new Date("2026-07-17T12:00:00.000Z"),
      }),
    ]);
  });

  it("accepts a valid DURATION interval", () => {
    const result = adapter.parse(
      calendar(`
BEGIN:VEVENT
UID:duration-event
DTSTAMP:20260715T120000Z
DTSTART:20260717T100000Z
DURATION:PT90M
SUMMARY:Duration event
END:VEVENT`),
      NOW
    );

    expect(result[0]).toEqual(
      expect.objectContaining({
        startAt: new Date("2026-07-17T10:00:00.000Z"),
        endAt: new Date("2026-07-17T11:30:00.000Z"),
      })
    );
  });

  it("rejects an exception whose recurrence ID is not in the master series", () => {
    const fixture = calendar(`
BEGIN:VEVENT
UID:invalid-exception
DTSTAMP:20260715T120000Z
DTSTART:20260716T100000Z
DTEND:20260716T110000Z
RRULE:FREQ=DAILY;COUNT=1
SUMMARY:One occurrence
END:VEVENT
BEGIN:VEVENT
UID:invalid-exception
RECURRENCE-ID:20260717T100000Z
DTSTAMP:20260715T130000Z
STATUS:CANCELLED
END:VEVENT`);

    expect(() => adapter.parse(fixture, NOW)).toThrow(
      "Event feed parse failed"
    );
  });

  it("rejects unsupported THISANDFUTURE range exceptions", () => {
    const fixture = calendar(`
BEGIN:VEVENT
UID:range-exception
DTSTAMP:20260715T120000Z
DTSTART:20260716T100000Z
DTEND:20260716T110000Z
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Series
END:VEVENT
BEGIN:VEVENT
UID:range-exception
RECURRENCE-ID;RANGE=THISANDFUTURE:20260717T100000Z
DTSTAMP:20260715T130000Z
DTSTART:20260717T120000Z
DTEND:20260717T130000Z
SUMMARY:Moved range
END:VEVENT`);

    expect(() => adapter.parse(fixture, NOW)).toThrow(
      "Event feed parse failed"
    );
  });

  it("rejects an EXDATE that is not in the master series", () => {
    const fixture = calendar(`
BEGIN:VEVENT
UID:invalid-exdate
DTSTAMP:20260715T120000Z
DTSTART:20260716T100000Z
DTEND:20260716T110000Z
RRULE:FREQ=DAILY;COUNT=1
EXDATE:20260717T100000Z
SUMMARY:One occurrence
END:VEVENT`);

    expect(() => adapter.parse(fixture, NOW)).toThrow(
      "Event feed parse failed"
    );
  });

  it("rejects a scheduled exception without DTSTART", () => {
    const fixture = calendar(`
BEGIN:VEVENT
UID:missing-exception-start
DTSTAMP:20260715T120000Z
DTSTART:20260716T100000Z
DTEND:20260716T110000Z
RRULE:FREQ=DAILY;COUNT=2
SUMMARY:Series
END:VEVENT
BEGIN:VEVENT
UID:missing-exception-start
RECURRENCE-ID:20260717T100000Z
DTSTAMP:20260715T130000Z
SUMMARY:Field-only override
END:VEVENT`);

    expect(() => adapter.parse(fixture, NOW)).toThrow(
      "Event feed parse failed"
    );
  });

  it("rejects recurrence identity timezone semantics that differ from DTSTART", () => {
    const fixture = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VTIMEZONE",
      "TZID:Asia/Dubai",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:+0400",
      "TZOFFSETTO:+0400",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:zone-mismatch",
      "DTSTAMP:20260715T120000Z",
      "DTSTART:20260716T100000Z",
      "DTEND:20260716T110000Z",
      "RRULE:FREQ=DAILY;COUNT=2",
      "SUMMARY:Series",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:zone-mismatch",
      "RECURRENCE-ID;TZID=Asia/Dubai:20260717T140000",
      "DTSTAMP:20260715T130000Z",
      "STATUS:CANCELLED",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");

    expect(() => adapter.parse(fixture, NOW)).toThrow(
      "Event feed parse failed"
    );
  });

  it.each([
    calendar(`
BEGIN:VEVENT
DTSTART:20260717T100000Z
DTEND:20260717T110000Z
SUMMARY:Missing UID
END:VEVENT`),
    calendar(`
BEGIN:VEVENT
UID:${"   "}
DTSTART:20260717T100000Z
DTEND:20260717T110000Z
SUMMARY:Blank UID
END:VEVENT`),
    calendar(`
BEGIN:VEVENT
UID:floating
DTSTART:20260717T100000
DTEND:20260717T110000
SUMMARY:Floating
END:VEVENT`),
    calendar(`
BEGIN:VEVENT
UID:backwards
DTSTART:20260717T110000Z
DTEND:20260717T100000Z
SUMMARY:Backwards
END:VEVENT`),
    calendar(`
BEGIN:VEVENT
UID:orphan
RECURRENCE-ID:20260717T100000Z
STATUS:CANCELLED
SUMMARY:Orphan
END:VEVENT`),
  ])("returns only a fixed safe error for malformed calendars", (fixture) => {
    expect(() => adapter.parse(fixture, NOW)).toThrow(
      "Event feed parse failed"
    );
  });

  it("rejects recurrence work over the fixed occurrence cap", () => {
    const fixture = calendar(`
BEGIN:VEVENT
UID:bomb
DTSTAMP:20260715T120000Z
DTSTART:20260716T000000Z
DTEND:20260716T000001Z
RRULE:FREQ=SECONDLY
SUMMARY:Bomb
END:VEVENT`);

    expect(() => adapter.parse(fixture, NOW)).toThrow(
      "Event feed parse failed"
    );
  });

  it("rejects sparse BY-part rules before recurrence iteration", () => {
    const fixture = calendar(`
BEGIN:VEVENT
UID:sparse-bomb
DTSTAMP:20260715T120000Z
DTSTART:20260716T000000Z
DTEND:20260716T010000Z
RRULE:FREQ=HOURLY;BYMONTH=2;BYMONTHDAY=31
SUMMARY:Sparse bomb
END:VEVENT`);

    expect(() => adapter.parse(fixture, NOW)).toThrow(
      "Event feed parse failed"
    );
  });
});
