import path from "node:path";
import {
  assertSafeArcSource,
  collectFromArcRows,
  collectFromMarkdownDocuments,
  collectFromPublicResults,
  collectFromVCard,
  isArcPublicJson,
  isAllowedMarkdownPath,
  publicUrlTitlePairs,
  readCopiedArcHistory,
  stableCandidateJsonl,
  type CollectorContact,
} from "./contact-enrichment-collector.js";

const contacts: CollectorContact[] = [
  {
    id: "contact-alex-river",
    firstName: "Alex",
    lastName: "River",
    aliases: ["A. River"],
  },
  {
    id: "contact-jordan-one",
    firstName: "Jordan",
    lastName: "Lee",
  },
  {
    id: "contact-jordan-two",
    firstName: "Jordan",
    lastName: "Lee",
  },
];

describe("contact enrichment collector", () => {
  it("extracts only labeled Markdown facts from exact or alias matches deterministically", () => {
    const documents = [
      {
        locator: "people/alex-river.md",
        retrievedAt: "2026-07-18T08:00:00.000Z",
        content: `---\nname: Alex River\ncompany: Synthetic Labs\ntitle: Research Lead\nbirthday: --02-29\nlinkedin: https://www.linkedin.com/in/alex-river\n---\nAlex probably works somewhere else.\n`,
      },
      {
        locator: "notes/alias.md",
        retrievedAt: "2026-07-18T08:00:00.000Z",
        content: `Name: A. River\nFirst met context: Synthetic conference lobby\nMaybe born in 1980.\n`,
      },
    ];

    const first = collectFromMarkdownDocuments(contacts, documents);
    const second = collectFromMarkdownDocuments(
      contacts,
      [...documents].reverse()
    );

    expect(stableCandidateJsonl(first)).toBe(stableCandidateJsonl(second));
    expect(first.map((item) => item.fieldName).sort()).toEqual([
      "birthday",
      "company",
      "firstMetContext",
      "jobTitle",
      "socialLinks",
    ]);
    expect(
      first.find((item) => item.fieldName === "birthday")?.proposedValue
    ).toEqual({
      month: 2,
      day: 29,
    });
    expect(stableCandidateJsonl(first)).not.toContain("1980");
    expect(stableCandidateJsonl(first)).not.toContain("somewhere else");
  });

  it("consumes vCard exports including yearless birthdays without accessing Contacts databases", () => {
    const candidates = collectFromVCard(
      contacts,
      `BEGIN:VCARD\nVERSION:4.0\nFN:Alex River\nBDAY:--0229\nORG:Synthetic Labs\nTITLE:Research Lead\nURL:https://example.org/alex\nEND:VCARD\n`,
      "exports/contacts.vcf",
      "2026-07-18T08:00:00.000Z"
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contactId: "contact-alex-river",
          fieldName: "birthday",
          proposedValue: { month: 2, day: 29 },
          sourceKind: "vcard",
          confidence: 0.99,
        }),
        expect.objectContaining({
          fieldName: "socialLinks",
          proposedValue: { website: "https://example.org/alex" },
        }),
      ])
    );
  });

  it("keeps ambiguous name-only public matches out but accepts an explicit contact id", () => {
    const candidates = collectFromPublicResults(contacts, [
      {
        name: "Jordan Lee",
        fieldName: "company",
        proposedValue: "Ambiguous Corp",
        sourceLocator: "https://example.org/result-ambiguous",
        retrievedAt: "2026-07-18T08:00:00.000Z",
      },
      {
        contactId: "contact-jordan-one",
        name: "Jordan Lee",
        fieldName: "company",
        proposedValue: "Corroborated Corp",
        sourceLocator: "https://example.org/result-explicit",
        retrievedAt: "2026-07-18T08:00:00.000Z",
        matchRationale: "Operator supplied the Socos contact id.",
      },
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      contactId: "contact-jordan-one",
      proposedValue: "Corroborated Corp",
      sourceKind: "public_web",
      confidence: 0.6,
    });
  });

  it.each([
    "http://example.org/result",
    "https://127.0.0.1/result",
    "https://localhost/result",
    "https://www.whitepages.com/result",
    "file:///tmp/result.json",
  ])("rejects unsafe public evidence locator %s", (sourceLocator) => {
    expect(
      collectFromPublicResults(contacts, [
        {
          contactId: "contact-alex-river",
          fieldName: "company",
          proposedValue: "Synthetic Labs",
          sourceLocator,
          retrievedAt: "2026-07-18T08:00:00.000Z",
        },
      ])
    ).toEqual([]);
  });

  it("copies a locked Arc History database before querying only URL and title", async () => {
    const calls: string[] = [];
    const rows = await readCopiedArcHistory(
      "/safe/Arc/User Data/Default/History",
      {
        makeTempDir: async () => "/tmp/arc-copy-synthetic",
        copyFile: async (source, target) => {
          calls.push(`copy:${source}:${target}`);
        },
        queryHistory: async (databasePath) => {
          calls.push(`query:${databasePath}`);
          return [
            { url: "https://github.com/alex-river", title: "Alex River" },
          ];
        },
        removeTempDir: async (directory) => {
          calls.push(`remove:${directory}`);
        },
      }
    );

    expect(rows).toEqual([
      { url: "https://github.com/alex-river", title: "Alex River" },
    ]);
    expect(calls).toEqual([
      "copy:/safe/Arc/User Data/Default/History:/tmp/arc-copy-synthetic/History.sqlite",
      "query:/tmp/arc-copy-synthetic/History.sqlite",
      "remove:/tmp/arc-copy-synthetic",
    ]);
  });

  it("accepts an HTTPS public website from Arc only on an exact unique title match", () => {
    const candidates = collectFromArcRows(
      contacts,
      [
        { url: "https://alex.example.org/", title: "Alex River" },
        { url: "https://unknown.example.org/alex-river", title: "Article" },
      ],
      "arc_history",
      "/safe/Arc/User Data/Default/History",
      "2026-07-18T08:00:00.000Z"
    );

    expect(candidates).toEqual([
      expect.objectContaining({
        contactId: "contact-alex-river",
        fieldName: "socialLinks",
        proposedValue: { website: "https://alex.example.org/" },
        confidence: 0.92,
      }),
    ]);
  });

  it("extracts only safe public URL/title pairs from realistic nested Arc sidebar data", () => {
    const rows = publicUrlTitlePairs({
      sidebar: {
        containers: [
          {
            spaces: [
              {
                items: [
                  {
                    data: {
                      savedURL: "https://github.com/alex-river",
                      savedTitle: "Alex River",
                      originalURL: "https://unrelated.example/private",
                      title: "Unrelated title",
                    },
                  },
                  {
                    data: {
                      url: "https://alex.example.org/",
                      title: "Alex River",
                    },
                  },
                  {
                    data: {
                      savedURL: "http://github.com/insecure",
                      savedTitle: "Insecure",
                    },
                  },
                  {
                    data: {
                      savedURL: "https://localhost/private",
                      savedTitle: "Local",
                    },
                  },
                  {
                    data: {
                      savedURL: "https://example.org/missing-title",
                      name: "Not an Arc public title field",
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(rows).toEqual([
      { url: "https://alex.example.org/", title: "Alex River" },
      { url: "https://github.com/alex-river", title: "Alex River" },
    ]);
  });

  it("allows only Arc's two supported public sidebar/archive JSON files", () => {
    expect(isArcPublicJson("/safe/Arc/StorableSidebar.json")).toBe(true);
    expect(isArcPublicJson("/safe/Arc/StorableArchiveItems.json")).toBe(true);
    expect(
      isArcPublicJson(
        "/safe/Arc/StorableCommandBarAdditionalRanking.json"
      )
    ).toBe(false);
    expect(isArcPublicJson("/safe/Arc/SidebarTelemetry.json")).toBe(false);
    expect(isArcPublicJson("/safe/Arc/ArchiveSecrets.json")).toBe(false);
  });

  it.each([
    "/safe/Arc/User Data/Default/Cookies",
    "/safe/Arc/User Data/Default/Login Data",
    "/safe/Arc/User Data/Default/Web Data",
    "/safe/Arc/User Data/Default/Local Storage",
    "/safe/Arc/User Data/Default/History-journal",
  ])("rejects secret-bearing or non-History Arc source %s", (source) => {
    expect(() => assertSafeArcSource(source)).toThrow("Unsafe Arc source");
  });

  it("allows Markdown only and excludes likely credential notes", () => {
    expect(isAllowedMarkdownPath(path.join("people", "alex-river.md"))).toBe(
      true
    );
    expect(isAllowedMarkdownPath(path.join("private", "passwords.md"))).toBe(
      false
    );
    expect(isAllowedMarkdownPath(path.join(".obsidian", "plugins.json"))).toBe(
      false
    );
    expect(isAllowedMarkdownPath(path.join("people", ".env"))).toBe(false);
  });
});
