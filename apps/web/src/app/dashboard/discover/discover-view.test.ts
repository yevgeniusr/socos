import { describe, expect, it } from "vitest";

import {
  buildEventCatalogQuery,
  certaintyLabel,
  EVENT_KIND_OPTIONS,
  freshnessLabel,
  followActionLabel,
  mergeCatalogFollow,
  mergeCatalogPages,
  rightsLabel,
  TRUST_TIER_OPTIONS,
  trustLabel,
  type EventCatalogItem,
} from "./discover-view";

const item: EventCatalogItem = {
  id: "catalog-uae-public-holidays",
  slug: "uae-public-holidays",
  title: "UAE public holidays",
  summary: "Official public holiday announcements for the UAE.",
  aliases: ["United Arab Emirates holidays"],
  tags: ["holidays", "uae"],
  kind: "country_holidays",
  status: "active",
  geographicScope: "country",
  countries: ["AE"],
  subdivisions: [],
  city: null,
  online: false,
  trustTier: "official",
  dateCertainty: "tentative",
  provenanceUrl: "https://u.ae/example",
  sourceRevision: "seed-2026-07-18",
  checkedAt: "2026-07-18T00:00:00.000Z",
  freshnessSlaHours: 168,
  rightsBasis: "metadata_only",
  termsUrl: null,
  attribution: "United Arab Emirates Government",
  updatedAt: "2026-07-18T00:00:00.000Z",
  followed: false,
  follow: null,
};

describe("discover view", () => {
  it("builds a normalized deterministic catalog query", () => {
    expect(
      buildEventCatalogQuery({
        q: "  AI events ",
        tags: ["Technology", " learning ", "technology"],
        kind: " conference ",
        country: " ae ",
        trust: " official ",
        followed: true,
        limit: 24,
        cursor: "next-page",
      })
    ).toBe(
      "q=AI+events&tags=technology%2Clearning&kind=conference&country=AE&trust=official&followed=true&limit=24&cursor=next-page"
    );
  });

  it("omits empty filters and keeps the page bound", () => {
    expect(
      buildEventCatalogQuery({
        q: " ",
        tags: [],
        kind: "",
        country: "",
        trust: "",
        followed: false,
        limit: 24,
      })
    ).toBe("followed=false&limit=24");
  });

  it("merges cursor pages without duplicate listings", () => {
    expect(
      mergeCatalogPages([item], [item, { ...item, slug: "un-days" }]).map(
        (entry) => entry.slug
      )
    ).toEqual(["uae-public-holidays", "un-days"]);
  });

  it("formats trust, certainty, and freshness without overstating evidence", () => {
    expect(trustLabel("official")).toBe("Official");
    expect(trustLabel("authoritative")).toBe("Authoritative");
    expect(rightsLabel("metadata_only")).toBe("Factual metadata only");
    expect(rightsLabel("source_terms")).toBe("Source terms apply");
    expect(rightsLabel("cc_by_4_0")).toBe("CC BY 4.0");
    expect(certaintyLabel("tentative")).toBe("Tentative date");
    expect(certaintyLabel("calculated")).toBe("Calculated date");
    expect(certaintyLabel("confirmed")).toBe("Confirmed date");
    expect(
      freshnessLabel(
        "2026-07-18T00:00:00.000Z",
        168,
        new Date("2026-07-19T00:00:00.000Z")
      )
    ).toBe("Checked 1 day ago");
    expect(
      freshnessLabel(
        "2026-07-01T00:00:00.000Z",
        24,
        new Date("2026-07-19T00:00:00.000Z")
      )
    ).toBe("Review overdue");
  });

  it("uses the catalog API taxonomy for filter values", () => {
    expect(EVENT_KIND_OPTIONS.map((option) => option.value)).toEqual([
      "country_holidays",
      "religious_observances",
      "global_celebrations",
      "conference_series",
      "local_events",
    ]);
    expect(TRUST_TIER_OPTIONS.map((option) => option.value)).toEqual([
      "official",
      "authoritative",
      "reviewed",
    ]);
  });

  it("applies owner follow mutations without replacing listing metadata", () => {
    const followed = mergeCatalogFollow(item, {
      slug: item.slug,
      followed: true,
      follow: { status: "active", socialWeight: 5 },
    });
    expect(followed.title).toBe(item.title);
    expect(followed.follow).toEqual({ status: "active", socialWeight: 5 });
    expect(followActionLabel(followed)).toBe("Pause");
    expect(
      followActionLabel({
        ...followed,
        follow: { status: "paused", socialWeight: 5 },
      })
    ).toBe("Resume");
    expect(followActionLabel(item)).toBe("Follow");
  });
});
