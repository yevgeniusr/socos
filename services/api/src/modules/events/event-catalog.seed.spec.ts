import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  EVENT_CATALOG_SEED_MANIFEST,
  type EventCatalogSeedItem,
  eventCatalogSeedContentHash,
} from "./event-catalog.seed.js";

function sqlQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function sqlArray(values: readonly string[]): string {
  return values.length === 0
    ? "ARRAY[]::TEXT[]"
    : `ARRAY[${values.map(sqlQuote).join(", ")}]::TEXT[]`;
}

function migrationRow(item: EventCatalogSeedItem): string {
  return [
    sqlQuote(item.id),
    sqlQuote(item.slug),
    sqlQuote(item.title),
    sqlQuote(item.summary),
    sqlArray(item.aliases),
    sqlArray(item.tags),
    sqlQuote(item.kind),
    sqlQuote(item.status),
    sqlQuote(item.geographicScope),
    sqlArray(item.countries),
    sqlArray(item.subdivisions),
    item.city === null ? "NULL" : sqlQuote(item.city),
    String(item.online),
    sqlQuote(item.trustTier),
    sqlQuote(item.dateCertainty),
    sqlQuote(item.provenanceUrl),
    sqlQuote(item.sourceRevision),
    sqlQuote(item.checkedAt),
    String(item.freshnessSlaHours),
    sqlQuote(item.rightsBasis),
    item.termsUrl === null ? "NULL" : sqlQuote(item.termsUrl),
    sqlQuote(item.attribution),
    sqlQuote(item.connectorType),
    sqlQuote(item.connectorReference),
    sqlQuote(eventCatalogSeedContentHash(item)),
    sqlQuote(item.checkedAt),
    sqlQuote(item.checkedAt),
  ].join(",\n    ");
}

describe("event catalog seed manifest", () => {
  it("is deterministic, unique, and carries complete trust metadata", () => {
    expect(EVENT_CATALOG_SEED_MANIFEST).toHaveLength(49);
    expect(
      new Set(EVENT_CATALOG_SEED_MANIFEST.map((item) => item.id)).size
    ).toBe(EVENT_CATALOG_SEED_MANIFEST.length);
    expect(
      new Set(EVENT_CATALOG_SEED_MANIFEST.map((item) => item.slug)).size
    ).toBe(EVENT_CATALOG_SEED_MANIFEST.length);

    for (const item of EVENT_CATALOG_SEED_MANIFEST) {
      expect(item).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^catalog-/),
          slug: expect.stringMatching(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
          provenanceUrl: expect.stringMatching(/^https:\/\//),
          sourceRevision: expect.stringMatching(/^seed-2026-07-18(?:-v2)?$/),
          checkedAt: expect.stringMatching(/^2026-07-18T/),
          freshnessSlaHours: expect.any(Number),
          rightsBasis: expect.stringMatching(
            /^(metadata_only|source_terms|cc_by_4_0)$/
          ),
          attribution: expect.any(String),
          connectorType: expect.any(String),
          connectorReference: expect.any(String),
        })
      );
      expect(eventCatalogSeedContentHash(item)).toMatch(/^[a-f0-9]{64}$/);
      expect(
        item.termsUrl === null || item.termsUrl.startsWith("https://")
      ).toBe(true);
      expect(eventCatalogSeedContentHash(item)).toBe(
        eventCatalogSeedContentHash({ ...item })
      );
      expect(item).not.toHaveProperty("license");
    }
  });

  it("covers the initial comprehensive source catalogue", () => {
    const slugs = new Set(EVENT_CATALOG_SEED_MANIFEST.map((item) => item.slug));

    expect(slugs.size).toBe(49);
    for (const slug of [
      "openholidays",
      "gov-uk-bank-holidays",
      "un-international-days",
      "bahai-calendar",
      "python-events",
      "linux-foundation-events",
      "dubai-calendar",
      "experience-abu-dhabi-events",
      "ticketmaster-discovery",
      "predicthq",
      "world-athletics-calendar",
    ]) {
      expect(slugs).toContain(slug);
    }
  });

  it("does not present mutable source feeds as confirmed occurrences", () => {
    for (const slug of [
      "python-events",
      "dubai-calendar",
      "world-athletics-calendar",
      "ticketmaster-discovery",
      "predicthq",
      "eventbrite-organizer-events",
      "meetup-groups",
    ]) {
      expect(
        EVENT_CATALOG_SEED_MANIFEST.find((item) => item.slug === slug)
          ?.dateCertainty
      ).toBe("tentative");
    }
    expect(
      EVENT_CATALOG_SEED_MANIFEST.find(
        (item) => item.slug === "sgpc-nanakshahi-calendar"
      )?.provenanceUrl
    ).toBe("https://sgpc.net/nanakshahi-calendar/");
  });

  it("keeps the expansion migration byte-for-byte aligned with the manifest", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "prisma/migrations/20260718180000_event_catalog_expansion/migration.sql"
      ),
      "utf8"
    );
    const expansion = EVENT_CATALOG_SEED_MANIFEST.filter(
      (item) => item.sourceRevision === "seed-2026-07-18-v2"
    );

    expect(expansion).toHaveLength(43);
    expect(migration.match(/'seed-2026-07-18-v2'/g)).toHaveLength(43);
    for (const item of expansion) {
      expect(migration).toContain(`  (\n    ${migrationRow(item)}\n  )`);
    }
  });
});
