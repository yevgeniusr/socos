import {
  EVENT_CATALOG_SEED_MANIFEST,
  eventCatalogSeedContentHash,
} from "./event-catalog.seed.js";

describe("event catalog seed manifest", () => {
  it("is deterministic, unique, and carries complete trust metadata", () => {
    expect(EVENT_CATALOG_SEED_MANIFEST.length).toBeGreaterThanOrEqual(5);
    expect(new Set(EVENT_CATALOG_SEED_MANIFEST.map((item) => item.id)).size).toBe(
      EVENT_CATALOG_SEED_MANIFEST.length
    );
    expect(new Set(EVENT_CATALOG_SEED_MANIFEST.map((item) => item.slug)).size).toBe(
      EVENT_CATALOG_SEED_MANIFEST.length
    );

    for (const item of EVENT_CATALOG_SEED_MANIFEST) {
      expect(item).toEqual(
        expect.objectContaining({
          id: expect.stringMatching(/^catalog-/),
          slug: expect.stringMatching(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
          provenanceUrl: expect.stringMatching(/^https:\/\//),
          sourceRevision: "seed-2026-07-18",
          checkedAt: "2026-07-18T00:00:00.000Z",
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
      expect(item.termsUrl === null || item.termsUrl.startsWith("https://")).toBe(
        true
      );
      expect(eventCatalogSeedContentHash(item)).toBe(
        eventCatalogSeedContentHash({ ...item })
      );
      expect(item).not.toHaveProperty("license");
    }
  });
});
