import type { InternalLocationContext } from "../location/location-context.service.js";
import { haversineDistanceM } from "../location/visit-derivation.service.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const SAME_CITY_DISTANCE_KM = 10;
const SAME_CITY_DISTANCE_SCORE = 15;

export type EventDistanceBand = "<2" | "2-10" | "10-25" | "25-50" | ">50" | "unknown";

export type EventRankingPreferences = {
  interestTags: string[];
  maxDistanceKm: number;
  travelSpeedKph: number;
  travelBufferMinutes: number;
};

export type EventRankingCandidate = {
  id: string;
  title: string;
  startAt: Date;
  endAt: Date;
  city: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string | null;
  tags: string[];
  sourceSocialWeight: number;
  locationContext: InternalLocationContext;
  matchedContactCount: number;
};

export type EventRankingFeedback = {
  eventId: string | null;
  category: string | null;
  action: "accept" | "snooze" | "dismiss";
  createdAt: Date;
  snoozedUntil: Date | null;
};

export type EventRankingEvidence = {
  components: {
    time: number;
    distance: number;
    interest: number;
    contacts: number;
    category: number;
    source: number;
    novelty: number;
    feedback: number;
  };
  distanceBand: EventDistanceBand;
  conflict: "clear";
  context: {
    source: InternalLocationContext["source"];
    freshness: InternalLocationContext["freshness"];
  };
  matchedTags: string[];
  category: string | null;
  plannedCity: string | null;
};

export type RankedEventCandidate = EventRankingCandidate & {
  score: number;
  knownDistanceKm: number | null;
  travelDistanceKm: number;
  evidence: EventRankingEvidence;
};

export function rankEventCandidates(input: {
  now: Date;
  preferences: EventRankingPreferences;
  candidates: EventRankingCandidate[];
  feedback: EventRankingFeedback[];
}): RankedEventCandidate[] {
  const feedback = input.feedback.filter(
    (item) =>
      item.createdAt.getTime() >= input.now.getTime() - 90 * DAY_MS &&
      item.createdAt.getTime() <= input.now.getTime()
  );
  const ranked: RankedEventCandidate[] = [];
  for (const candidate of input.candidates) {
    if (candidate.endAt.getTime() <= input.now.getTime()) continue;
    if (isExcludedByFeedback(candidate, feedback, input.now)) continue;
    const distance = resolveDistance(candidate, input.preferences.maxDistanceKm);
    if (!distance.eligible) continue;
    const matchedTags = publicMatchedTags(candidate.tags, input.preferences.interestTags);
    const components = {
      time: timeScore(candidate, input.now),
      distance: distance.score,
      interest: Math.min(15, matchedTags.length * 5),
      contacts: Math.min(15, Math.max(0, candidate.matchedContactCount) * 5),
      category: categoryBoost(candidate.category),
      source: Math.min(10, Math.max(0, Math.round(candidate.sourceSocialWeight))),
      novelty: noveltyScore(candidate, feedback, input.now),
      feedback: feedbackScore(candidate, feedback),
    };
    const score = Math.min(
      100,
      Object.values(components).reduce((sum, value) => sum + value, 0)
    );
    ranked.push({
      ...candidate,
      score,
      knownDistanceKm: distance.knownDistanceKm,
      travelDistanceKm: distance.travelDistanceKm,
      evidence: {
        components,
        distanceBand:
          distance.knownDistanceKm === null
            ? "unknown"
            : distanceBand(distance.knownDistanceKm),
        conflict: "clear",
        context: {
          source: candidate.locationContext.source,
          freshness: candidate.locationContext.freshness,
        },
        matchedTags,
        category: normalizedCategory(candidate.category),
        plannedCity: candidate.city,
      },
    });
  }
  return ranked.sort(compareRankedEvents);
}

export function distanceBand(km: number): EventDistanceBand {
  if (km < 2) return "<2";
  if (km < 10) return "2-10";
  if (km <= 25) return "10-25";
  if (km <= 50) return "25-50";
  return ">50";
}

function timeScore(candidate: EventRankingCandidate, now: Date): number {
  const startsInMs = candidate.startAt.getTime() - now.getTime();
  if (startsInMs <= 48 * 60 * 60 * 1_000) return 25;
  if (startsInMs <= 7 * DAY_MS) return 20;
  if (startsInMs <= 14 * DAY_MS) return 15;
  return 0;
}

function resolveDistance(candidate: EventRankingCandidate, maxDistanceKm: number) {
  const origin = candidate.locationContext.origin;
  if (
    origin &&
    Number.isFinite(candidate.latitude) &&
    Number.isFinite(candidate.longitude)
  ) {
    const km =
      haversineDistanceM(origin, {
        lat: candidate.latitude as number,
        lon: candidate.longitude as number,
      }) / 1000;
    return {
      eligible: km <= maxDistanceKm,
      knownDistanceKm: km,
      travelDistanceKm: km,
      score: Math.round(25 * Math.max(0, 1 - km / maxDistanceKm)),
    };
  }
  if (sameCity(candidate)) {
    return {
      eligible: SAME_CITY_DISTANCE_KM <= maxDistanceKm,
      knownDistanceKm: SAME_CITY_DISTANCE_KM,
      travelDistanceKm: SAME_CITY_DISTANCE_KM,
      score: SAME_CITY_DISTANCE_SCORE,
    };
  }
  return {
    eligible: true,
    knownDistanceKm: null,
    travelDistanceKm: 0,
    score: 0,
  };
}

function sameCity(candidate: EventRankingCandidate): boolean {
  const eventCity = canonicalText(candidate.city);
  const contextCity = canonicalText(candidate.locationContext.city);
  if (!eventCity || !contextCity || eventCity !== contextCity) return false;
  const eventCountry = canonicalText(candidate.countryCode);
  const contextCountry = canonicalText(candidate.locationContext.countryCode);
  return !eventCountry || !contextCountry || eventCountry === contextCountry;
}

function publicMatchedTags(publicTags: string[], preferenceTags: string[]): string[] {
  const publicByCanonical = new Map<string, string>();
  for (const tag of publicTags) {
    const canonical = canonicalTag(tag);
    if (canonical && !publicByCanonical.has(canonical)) {
      publicByCanonical.set(canonical, tag.normalize("NFC").trim());
    }
  }
  const preference = new Set(preferenceTags.map(canonicalTag).filter(Boolean));
  return [...publicByCanonical.entries()]
    .filter(([canonical]) => preference.has(canonical))
    .map(([canonical]) => canonical)
    .sort();
}

function categoryBoost(category: string | null): number {
  return ["social", "networking", "community"].includes(
    normalizedCategory(category) ?? ""
  )
    ? 10
    : 0;
}

function noveltyScore(
  candidate: EventRankingCandidate,
  feedback: EventRankingFeedback[],
  now: Date
): number {
  const cutoff = now.getTime() - 30 * DAY_MS;
  const hasRecent = feedback.some(
    (item) =>
      item.createdAt.getTime() >= cutoff &&
      (item.eventId === candidate.id ||
        (normalizedCategory(candidate.category) !== null &&
          item.category === normalizedCategory(candidate.category)))
  );
  return hasRecent ? 0 : 10;
}

function feedbackScore(
  candidate: EventRankingCandidate,
  feedback: EventRankingFeedback[]
): number {
  const category = normalizedCategory(candidate.category);
  let score = 5;
  for (const item of feedback) {
    if (item.eventId !== candidate.id && (!category || item.category !== category)) {
      continue;
    }
    if (item.action === "accept") score += 5;
    if (item.action === "dismiss") score -= 5;
  }
  return Math.max(0, Math.min(10, score));
}

function isExcludedByFeedback(
  candidate: EventRankingCandidate,
  feedback: EventRankingFeedback[],
  now: Date
): boolean {
  const cutoff = now.getTime() - 30 * DAY_MS;
  const category = normalizedCategory(candidate.category);
  let categoryDismissals = 0;
  for (const item of feedback) {
    if (item.snoozedUntil && item.eventId === candidate.id && item.snoozedUntil > now) {
      return true;
    }
    if (item.createdAt.getTime() < cutoff) continue;
    if (item.action === "dismiss" && item.eventId === candidate.id) {
      return true;
    }
    if (
      item.action === "dismiss" &&
      category !== null &&
      item.category === category
    ) {
      categoryDismissals += 1;
    }
  }
  return categoryDismissals >= 2;
}

function compareRankedEvents(
  left: RankedEventCandidate,
  right: RankedEventCandidate
): number {
  return (
    right.score - left.score ||
    left.startAt.getTime() - right.startAt.getTime() ||
    asciiCompare(left.id, right.id)
  );
}

function asciiCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizedCategory(category: string | null): string | null {
  return canonicalTag(category);
}

function canonicalTag(value: string | null | undefined): string {
  return canonicalText(value);
}

function canonicalText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("en-US");
}
