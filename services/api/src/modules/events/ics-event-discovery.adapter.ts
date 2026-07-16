import { Injectable } from "@nestjs/common";
import ICAL from "ical.js";
import type { NormalizedDiscoveredEvent } from "./events.types.js";

const SAFE_ERROR = "Event feed parse failed";
const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_COMPONENTS = 5_000;
const MAX_OCCURRENCES = 10_000;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const DEADLINE_MS = 10_000;

@Injectable()
export class IcsEventDiscoveryAdapter {
  parse(
    source: string,
    now = new Date(),
    deadlineAt = Date.now() + DEADLINE_MS
  ): NormalizedDiscoveredEvent[] {
    try {
      return this.parseUnsafe(source, now, deadlineAt);
    } catch {
      throw new Error(SAFE_ERROR);
    }
  }

  private parseUnsafe(
    source: string,
    now: Date,
    deadlineAt: number
  ): NormalizedDiscoveredEvent[] {
    assertDeadline(deadlineAt);
    if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
      throw new Error(SAFE_ERROR);
    }
    const parsed = ICAL.parse(source);
    assertDeadline(deadlineAt);
    const root = new ICAL.Component(parsed);
    if (root.name !== "vcalendar") throw new Error(SAFE_ERROR);
    if (countComponents(root, deadlineAt) > MAX_COMPONENTS) {
      throw new Error(SAFE_ERROR);
    }
    const components = root.getAllSubcomponents("vevent");
    if (components.length > MAX_COMPONENTS) {
      throw new Error(SAFE_ERROR);
    }

    const groups = new Map<string, ICAL.Component[]>();
    for (const component of components) {
      assertDeadline(deadlineAt);
      const uid = requiredString(component.getFirstPropertyValue("uid"));
      const existing = groups.get(uid) ?? [];
      existing.push(component);
      groups.set(uid, existing);
    }

    const windowEnd = new Date(now.getTime() + WINDOW_MS);
    const output: NormalizedDiscoveredEvent[] = [];
    let work = 0;
    for (const [uid, grouped] of groups) {
      const masters = grouped.filter(
        (component) => !component.getFirstProperty("recurrence-id")
      );
      const exceptions = grouped.filter((component) =>
        Boolean(component.getFirstProperty("recurrence-id"))
      );
      if (masters.length !== 1) throw new Error(SAFE_ERROR);

      const masterComponent = masters[0];
      const master = new ICAL.Event(masterComponent, {
        strictExceptions: true,
        exceptions: exceptions.filter((component) =>
          Boolean(component.getFirstProperty("dtstart"))
        ),
      });
      validateTime(
        master.startDate,
        masterComponent.getFirstProperty("dtstart")
      );
      validateTime(master.endDate, intervalEvidence(masterComponent));
      const masterStart = master.startDate.toJSDate();
      const masterEnd = master.endDate.toJSDate();
      if (!(masterEnd.getTime() > masterStart.getTime()))
        throw new Error(SAFE_ERROR);
      const durationMs = masterEnd.getTime() - masterStart.getTime();
      validateBoundedRecurrence(masterComponent);

      const exceptionByIdentity = new Map<string, ICAL.Component>();
      for (const exception of exceptions) {
        const recurrenceProperty = exception.getFirstProperty("recurrence-id");
        if (!recurrenceProperty || recurrenceProperty.getParameter("range")) {
          throw new Error(SAFE_ERROR);
        }
        const recurrence = timeValue(exception, "recurrence-id");
        validateTime(recurrence, recurrenceProperty);
        if (!sameTimeSemantics(recurrence, master.startDate)) {
          throw new Error(SAFE_ERROR);
        }
        if (
          !exception.getFirstProperty("dtstart") &&
          masterStatus(exception) !== "cancelled"
        ) {
          throw new Error(SAFE_ERROR);
        }
        const identity = recurrenceIdentity(recurrence);
        if (exceptionByIdentity.has(identity)) throw new Error(SAFE_ERROR);
        exceptionByIdentity.set(identity, exception);
      }

      if (!master.isRecurring()) {
        if (
          exceptions.length > 0 ||
          masterComponent.getAllProperties("exdate").length > 0
        ) {
          throw new Error(SAFE_ERROR);
        }
        if (overlaps(masterStart, masterEnd, now, windowEnd)) {
          output.push(
            normalizeInstance(
              uid,
              masterComponent,
              master.startDate,
              masterStart,
              masterEnd,
              masterStatus(masterComponent)
            )
          );
        }
        continue;
      }

      const recurrenceTypes = Object.keys(master.getRecurrenceTypes());
      if (
        recurrenceTypes.some((frequency) =>
          ["SECONDLY", "MINUTELY"].includes(frequency.toUpperCase())
        )
      ) {
        throw new Error(SAFE_ERROR);
      }

      const exdates = propertyTimes(
        masterComponent,
        "exdate",
        deadlineAt,
        () => {
          work += 1;
          if (work > MAX_OCCURRENCES) throw new Error(SAFE_ERROR);
        }
      );
      const exdateIdentities = new Set<string>();
      for (const exdate of exdates) {
        if (!sameTimeSemantics(exdate, master.startDate)) {
          throw new Error(SAFE_ERROR);
        }
        const identity = recurrenceIdentity(exdate);
        if (
          exdateIdentities.has(identity) ||
          exceptionByIdentity.has(identity)
        ) {
          throw new Error(SAFE_ERROR);
        }
        exdateIdentities.add(identity);
      }

      const seen = new Set<string>();
      const latestRelevantAt = Math.max(
        Number.NEGATIVE_INFINITY,
        ...[...exceptionByIdentity.values()].map((component) =>
          timeValue(component, "recurrence-id").toJSDate().getTime()
        ),
        ...exdates.map((time) => time.toJSDate().getTime())
      );
      const expansionComponent = new ICAL.Component(
        structuredClone(masterComponent.toJSON())
      );
      expansionComponent.removeAllProperties("exdate");
      const iterator = new ICAL.RecurExpansion({
        component: expansionComponent,
        dtstart: master.startDate,
      });
      let occurrence: ICAL.Time | null;
      while (true) {
        assertDeadline(deadlineAt);
        occurrence = iterator.next();
        assertDeadline(deadlineAt);
        if (!occurrence) break;
        work += 1;
        if (work > MAX_OCCURRENCES) throw new Error(SAFE_ERROR);
        const occurrenceDate = occurrence.toJSDate();
        if (
          occurrenceDate >= windowEnd &&
          occurrenceDate.getTime() > latestRelevantAt
        ) {
          break;
        }
        const identity = recurrenceIdentity(occurrence);
        const component = exceptionByIdentity.get(identity) ?? masterComponent;
        const cancelled =
          masterStatus(masterComponent) === "cancelled" ||
          masterStatus(component) === "cancelled" ||
          exdateIdentities.has(identity);
        let start = occurrenceDate;
        let end = new Date(start.getTime() + durationMs);
        const exception = exceptionByIdentity.get(identity);
        if (exception?.getFirstProperty("dtstart")) {
          const detail = master.getOccurrenceDetails(occurrence);
          validateTime(
            detail.startDate,
            detail.item.component.getFirstProperty("dtstart")
          );
          validateTime(
            detail.endDate,
            intervalEvidence(detail.item.component) ??
              intervalEvidence(masterComponent)
          );
          start = detail.startDate.toJSDate();
          end = detail.endDate.toJSDate();
        }
        if (!(end > start)) throw new Error(SAFE_ERROR);
        if (overlaps(start, end, now, windowEnd)) {
          output.push(
            normalizeInstance(
              uid,
              component,
              occurrence,
              start,
              end,
              cancelled ? "cancelled" : "scheduled",
              masterComponent
            )
          );
        }
        seen.add(identity);
      }

      for (const identity of exceptionByIdentity.keys()) {
        if (seen.has(identity)) continue;
        throw new Error(SAFE_ERROR);
      }
      for (const identity of exdateIdentities) {
        if (seen.has(identity)) continue;
        throw new Error(SAFE_ERROR);
      }
    }

    return output.sort(
      (left, right) =>
        left.startAt.getTime() - right.startAt.getTime() ||
        left.providerEventId.localeCompare(right.providerEventId)
    );
  }
}

function normalizeInstance(
  uid: string,
  component: ICAL.Component,
  recurrence: ICAL.Time,
  startAt: Date,
  endAt: Date,
  status: "scheduled" | "cancelled",
  fallback = component
): NormalizedDiscoveredEvent {
  const identity = `${uid}:${recurrenceIdentity(recurrence)}`;
  const geo = inheritedValue(component, fallback, "geo");
  const coordinates = parseGeo(geo);
  const categoryProperties = component.getAllProperties("categories");
  const categories = (
    categoryProperties.length > 0
      ? categoryProperties
      : fallback.getAllProperties("categories")
  )
    .flatMap((property) => property.getValues())
    .map((value) => publicText(value, 100, false))
    .filter((value): value is string => value !== null);
  const tags = [...new Set(categories)];
  if (tags.length > 50) throw new Error(SAFE_ERROR);
  const url = safeEventUrl(inheritedValue(component, fallback, "url"));
  const providerTime =
    optionalTime(component, "last-modified") ??
    optionalTime(component, "dtstamp") ??
    optionalTime(fallback, "last-modified") ??
    optionalTime(fallback, "dtstamp");
  const effectiveStart = inheritedValue(component, fallback, "dtstart");
  if (!(effectiveStart instanceof ICAL.Time)) throw new Error(SAFE_ERROR);
  const titleValue = inheritedValue(component, fallback, "summary");
  if (typeof titleValue !== "string") throw new Error(SAFE_ERROR);

  return {
    providerEventId: identity,
    canonicalIdentity: identity,
    title: publicText(titleValue, 500, true)!,
    descriptionExcerpt: publicText(
      inheritedValue(component, fallback, "description"),
      1_000,
      false
    ),
    url,
    startAt,
    endAt,
    timeZone: effectiveStart.isDate ? null : effectiveStart.zone.tzid,
    venueName: publicText(
      inheritedValue(component, fallback, "location"),
      500,
      false
    ),
    address: publicText(
      inheritedValue(component, fallback, "x-address"),
      500,
      false
    ),
    city: publicText(inheritedValue(component, fallback, "x-city"), 500, false),
    countryCode: normalizeCountry(
      inheritedValue(component, fallback, "x-country-code")
    ),
    latitude: coordinates?.latitude ?? null,
    longitude: coordinates?.longitude ?? null,
    category: tags[0] ?? null,
    tags,
    status,
    sourceUpdatedAt: providerTime?.toJSDate() ?? null,
    expiresAt: endAt,
  };
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(SAFE_ERROR);
  }
  return value;
}

function publicText(
  value: unknown,
  maxCodePoints: number,
  required: boolean
): string | null {
  if (value === null || value === undefined) {
    if (required) throw new Error(SAFE_ERROR);
    return null;
  }
  if (typeof value !== "string") throw new Error(SAFE_ERROR);
  const normalized = value.normalize("NFC").trim();
  if ((required && !normalized) || [...normalized].length > maxCodePoints) {
    throw new Error(SAFE_ERROR);
  }
  return normalized || null;
}

function safeEventUrl(value: unknown): string | null {
  const text = publicText(value, 2_048, false);
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(SAFE_ERROR);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.href.includes("#") ||
    [...url.href].length > 2_048
  ) {
    throw new Error(SAFE_ERROR);
  }
  return url.href;
}

function parseGeo(
  value: unknown
): { latitude: number; longitude: number } | null {
  if (value === null || value === undefined) return null;
  let latitude: number;
  let longitude: number;
  if (Array.isArray(value) && value.length === 2) {
    latitude = Number(value[0]);
    longitude = Number(value[1]);
  } else if (typeof value === "object") {
    const geo = value as { latitude?: unknown; longitude?: unknown };
    latitude = Number(geo.latitude);
    longitude = Number(geo.longitude);
  } else {
    throw new Error(SAFE_ERROR);
  }
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error(SAFE_ERROR);
  }
  return { latitude, longitude };
}

function timeValue(component: ICAL.Component, name: string): ICAL.Time {
  const value = component.getFirstPropertyValue(name);
  if (!(value instanceof ICAL.Time)) throw new Error(SAFE_ERROR);
  return value;
}

function optionalTime(
  component: ICAL.Component,
  name: string
): ICAL.Time | null {
  const value = component.getFirstPropertyValue(name);
  if (value === null) return null;
  if (!(value instanceof ICAL.Time)) throw new Error(SAFE_ERROR);
  validateTime(value, component.getFirstProperty(name));
  if (value.isDate) throw new Error(SAFE_ERROR);
  return value;
}

function propertyTimes(
  component: ICAL.Component,
  name: string,
  deadlineAt: number,
  onValue: () => void
): ICAL.Time[] {
  const result: ICAL.Time[] = [];
  for (const property of component.getAllProperties(name)) {
    assertDeadline(deadlineAt);
    for (const value of property.getValues()) {
      assertDeadline(deadlineAt);
      onValue();
      if (!(value instanceof ICAL.Time)) throw new Error(SAFE_ERROR);
      validateTime(value, property);
      result.push(value);
    }
  }
  return result;
}

function validateTime(time: ICAL.Time, property: ICAL.Property | null): void {
  if (!property) throw new Error(SAFE_ERROR);
  if (!time.isDate && time.zone.tzid === "floating")
    throw new Error(SAFE_ERROR);
  const date = time.toJSDate();
  if (!Number.isFinite(date.getTime())) throw new Error(SAFE_ERROR);
}

function recurrenceIdentity(time: ICAL.Time): string {
  if (time.isDate) {
    return `${String(time.year).padStart(4, "0")}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
  }
  return time.toJSDate().toISOString();
}

function masterStatus(component: ICAL.Component): "scheduled" | "cancelled" {
  const value = component.getFirstPropertyValue("status");
  return typeof value === "string" && value.toUpperCase() === "CANCELLED"
    ? "cancelled"
    : "scheduled";
}

function overlaps(start: Date, end: Date, from: Date, until: Date): boolean {
  return start < until && end > from;
}

function normalizeCountry(value: unknown): string | null {
  const text = publicText(value, 2, false);
  if (!text) return null;
  if (!/^[A-Za-z]{2}$/.test(text)) throw new Error(SAFE_ERROR);
  return text.toUpperCase();
}

function assertDeadline(deadlineAt: number): void {
  if (Date.now() > deadlineAt) throw new Error(SAFE_ERROR);
}

function inheritedValue(
  component: ICAL.Component,
  fallback: ICAL.Component,
  name: string
): ReturnType<ICAL.Component["getFirstPropertyValue"]> {
  return component.getFirstProperty(name)
    ? component.getFirstPropertyValue(name)
    : fallback.getFirstPropertyValue(name);
}

function countComponents(
  component: ICAL.Component,
  deadlineAt: number
): number {
  assertDeadline(deadlineAt);
  let count = 1;
  for (const child of component.getAllSubcomponents()) {
    count += countComponents(child, deadlineAt);
    if (count > MAX_COMPONENTS) return count;
  }
  return count;
}

function intervalEvidence(component: ICAL.Component): ICAL.Property | null {
  const explicit =
    component.getFirstProperty("dtend") ??
    component.getFirstProperty("duration");
  if (explicit) return explicit;
  const start = component.getFirstPropertyValue("dtstart");
  return start instanceof ICAL.Time && start.isDate
    ? component.getFirstProperty("dtstart")
    : null;
}

function sameTimeSemantics(left: ICAL.Time, right: ICAL.Time): boolean {
  if (left.isDate !== right.isDate) return false;
  return left.isDate || left.zone.tzid === right.zone.tzid;
}

function validateBoundedRecurrence(component: ICAL.Component): void {
  if (
    component.getAllProperties("rdate").length > 0 ||
    component.getAllProperties("exrule").length > 0
  ) {
    throw new Error(SAFE_ERROR);
  }
  const rules = component.getAllProperties("rrule");
  if (rules.length > 1) throw new Error(SAFE_ERROR);
  for (const property of rules) {
    const rule = property.getFirstValue();
    if (!(rule instanceof ICAL.Recur)) throw new Error(SAFE_ERROR);
    if (
      !["HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(
        rule.freq.toUpperCase()
      ) ||
      !Number.isInteger(rule.interval) ||
      rule.interval < 1 ||
      rule.interval > 3_660 ||
      Object.keys(rule.parts).length > 0
    ) {
      throw new Error(SAFE_ERROR);
    }
  }
}
