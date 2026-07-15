import { createHash } from "node:crypto";
import {
  ImportFailure,
  parseMonicaExport,
  runMonicaImport,
  safeFailureCode,
  type ImportContact,
  type ImportStore,
} from "./monica-import";

const syntheticContacts: ImportContact[] = [
  {
    sourceId: "source-1",
    firstName: "Synthetic One",
    lastName: null,
    middleName: null,
    nickname: null,
    company: null,
    jobTitle: null,
    labels: ["Friends"],
    groups: ["Dubai"],
    sourceCreatedAt: "2026-01-01T00:00:00.000Z",
    sourceUpdatedAt: "2026-01-02T00:00:00.000Z",
  },
  {
    sourceId: "source-2",
    firstName: "Synthetic Two",
    lastName: "Example",
    middleName: null,
    nickname: "Two",
    company: "Synthetic Company",
    jobTitle: "Builder",
    labels: [],
    groups: [],
    sourceCreatedAt: "2026-01-03T00:00:00.000Z",
    sourceUpdatedAt: "2026-01-04T00:00:00.000Z",
  },
];

function exportStream(
  contacts = syntheticContacts,
  overrides: { count?: number; sha256?: string } = {}
): string {
  const contactLines = contacts.map((contact) =>
    JSON.stringify({ type: "contact", ...contact })
  );
  const sha256 = createHash("sha256")
    .update(contactLines.map((line) => `${line}\n`).join(""))
    .digest("hex");

  return [
    JSON.stringify({
      type: "header",
      format: "socos-monica-contacts",
      version: 1,
    }),
    ...contactLines,
    JSON.stringify({
      type: "trailer",
      count: overrides.count ?? contacts.length,
      sha256: overrides.sha256 ?? sha256,
    }),
    "",
  ].join("\n");
}

class MemoryStore implements ImportStore {
  connectCalls = 0;
  transactionCalls = 0;
  rollbackCalls = 0;
  contacts = new Map<string, ImportContact>();
  demoCount = 0;
  baselineCount = 7;
  failAfterUpsert: number | null = null;
  private upsertCalls = 0;

  async connect(): Promise<void> {
    this.connectCalls += 1;
  }

  async close(): Promise<void> {}

  async transaction<T>(callback: () => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    const snapshot = {
      contacts: new Map(this.contacts),
      demoCount: this.demoCount,
      baselineCount: this.baselineCount,
    };
    try {
      return await callback();
    } catch (error) {
      this.contacts = snapshot.contacts;
      this.demoCount = snapshot.demoCount;
      this.baselineCount = snapshot.baselineCount;
      this.rollbackCalls += 1;
      throw error;
    }
  }

  async acquireImportLock(): Promise<void> {}

  async selectOwnerVault(): Promise<{ ownerId: string; vaultId: string }> {
    return { ownerId: "owner-1", vaultId: "vault-1" };
  }

  async prepareDemoBaseline(): Promise<void> {
    if (this.contacts.size === 0) {
      if (this.baselineCount !== 7) {
        throw new ImportFailure("baseline_count_mismatch");
      }
      this.demoCount = this.baselineCount;
      this.baselineCount = 0;
    }
  }

  async upsertContact(contact: ImportContact): Promise<"created" | "updated"> {
    this.upsertCalls += 1;
    if (this.failAfterUpsert === this.upsertCalls) {
      throw new ImportFailure("synthetic_write_failure");
    }
    const outcome = this.contacts.has(contact.sourceId) ? "updated" : "created";
    this.contacts.set(contact.sourceId, contact);
    return outcome;
  }

  async assertFinalCounts(
    _ownerId: string,
    expectedImported: number
  ): Promise<void> {
    if (this.contacts.size !== expectedImported || this.demoCount !== 7) {
      throw new ImportFailure("final_count_mismatch");
    }
  }
}

describe("Monica export validation", () => {
  it("parses a complete versioned export with a valid checksum", () => {
    expect(parseMonicaExport(exportStream(), 2)).toEqual(syntheticContacts);
  });

  it.each([
    [
      "unsupported version",
      exportStream().replace('"version":1', '"version":2'),
      "unsupported_version",
    ],
    [
      "truncated stream",
      exportStream().split("\n").slice(0, -2).join("\n"),
      "missing_trailer",
    ],
    [
      "wrong trailer count",
      exportStream(syntheticContacts, { count: 1 }),
      "trailer_count_mismatch",
    ],
    [
      "wrong checksum",
      exportStream(syntheticContacts, { sha256: "0".repeat(64) }),
      "checksum_mismatch",
    ],
    ["wrong expected count", exportStream(), "expected_count_mismatch", 3],
  ])(
    "rejects %s without exposing record content",
    (_name, stream, code, expected = 2) => {
      let failure: unknown;
      try {
        parseMonicaExport(stream, expected as number);
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(ImportFailure);
      expect((failure as ImportFailure).code).toBe(code);
      expect(String(failure)).not.toContain("Synthetic");
      expect(String(failure)).not.toContain("source-1");
    }
  );

  it("rejects duplicate source identifiers", () => {
    const duplicate = [syntheticContacts[0], syntheticContacts[0]];
    expect(() => parseMonicaExport(exportStream(duplicate), 2)).toThrow(
      expect.objectContaining({ code: "duplicate_source_id" })
    );
  });

  it("collapses unknown failures without returning their message", () => {
    const failure = new Error("Synthetic One source-1");
    expect(safeFailureCode(failure)).toBe("import_failed");
    expect(safeFailureCode(failure)).not.toContain("Synthetic");
  });
});

describe("Monica import transaction", () => {
  it("does not connect to Socos until the entire stream is valid", async () => {
    const store = new MemoryStore();

    await expect(
      runMonicaImport(
        exportStream(syntheticContacts, { sha256: "0".repeat(64) }),
        2,
        store
      )
    ).rejects.toMatchObject({ code: "checksum_mismatch" });

    expect(store.connectCalls).toBe(0);
    expect(store.transactionCalls).toBe(0);
  });

  it("is idempotent by Monica source identifier", async () => {
    const store = new MemoryStore();

    await expect(runMonicaImport(exportStream(), 2, store)).resolves.toEqual({
      imported: 2,
      created: 2,
      updated: 0,
      demos: 7,
    });
    await expect(runMonicaImport(exportStream(), 2, store)).resolves.toEqual({
      imported: 2,
      created: 0,
      updated: 2,
      demos: 7,
    });

    expect(store.contacts.size).toBe(2);
    expect(store.demoCount).toBe(7);
  });

  it("rolls back demo marking and all contacts after a write failure", async () => {
    const store = new MemoryStore();
    store.failAfterUpsert = 2;

    await expect(
      runMonicaImport(exportStream(), 2, store)
    ).rejects.toMatchObject({
      code: "synthetic_write_failure",
    });

    expect(store.rollbackCalls).toBe(1);
    expect(store.contacts.size).toBe(0);
    expect(store.demoCount).toBe(0);
    expect(store.baselineCount).toBe(7);
  });
});
