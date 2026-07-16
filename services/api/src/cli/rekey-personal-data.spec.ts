import type { ConfigService } from "@nestjs/config";
import type { PrismaClient } from "@prisma/client";
import { PersonalDataCipherService } from "../modules/personal-data/personal-data-cipher.service.js";
import { PERSONAL_DATA_ENVELOPES } from "../modules/personal-data/personal-data-envelope.registry.js";
import {
  parseRekeyArguments,
  PrismaPersonalDataRekeyStore,
  runPersonalDataRekey,
  safeRekeyFailureCode,
  type PersonalDataEnvelopeRow,
  type PersonalDataRekeyStore,
  type PersonalDataRekeyTransaction,
} from "./rekey-personal-data.js";

const KEY_ONE = Buffer.alloc(32, 0x11);
const KEY_TWO = Buffer.alloc(32, 0x22);

function config(): ConfigService {
  return {
    get: jest.fn((name: string) => {
      if (name === "PERSONAL_DATA_KEYS") {
        return JSON.stringify([
          { version: 1, key: KEY_ONE.toString("base64") },
          { version: 2, key: KEY_TWO.toString("base64") },
        ]);
      }
      if (name === "PERSONAL_DATA_ACTIVE_KEY_VERSION") return "1";
      return undefined;
    }),
  } as unknown as ConfigService;
}

function encryptedRow(
  cipher: PersonalDataCipherService,
  envelopeIndex: number,
  id: string,
  ownerId = "synthetic-owner"
): PersonalDataEnvelopeRow {
  const envelope = PERSONAL_DATA_ENVELOPES[envelopeIndex];
  return {
    id,
    ownerId,
    ...cipher.encrypt(
      envelope.purpose,
      ownerId,
      id,
      `synthetic-value-${envelopeIndex}-${id}`
    ),
  };
}

class MemoryRekeyStore
  implements PersonalDataRekeyStore, PersonalDataRekeyTransaction
{
  readonly pages: number[] = [];
  readonly transactionSizes: number[] = [];
  readonly rows = new Map<string, PersonalDataEnvelopeRow[]>();
  closed = false;
  decryptions = 0;
  updates = 0;
  contendIds = new Set<string>();
  interruptTransaction: number | undefined;
  private transactionCount = 0;
  private activeTransactionUpdates = 0;

  seed(envelopeIndex: number, rows: PersonalDataEnvelopeRow[]): void {
    this.rows.set(envelopeKey(PERSONAL_DATA_ENVELOPES[envelopeIndex]), rows);
  }

  async count(
    envelope: (typeof PERSONAL_DATA_ENVELOPES)[number],
    from: number
  ) {
    return (this.rows.get(envelopeKey(envelope)) ?? []).filter(
      (row) => row.keyVersion === from
    ).length;
  }

  async transaction<T>(
    callback: (transaction: PersonalDataRekeyTransaction) => Promise<T>
  ): Promise<T> {
    this.transactionCount += 1;
    if (this.transactionCount === this.interruptTransaction) {
      throw new Error("synthetic-sensitive-interruption");
    }
    this.activeTransactionUpdates = 0;
    const result = await callback(this);
    this.transactionSizes.push(this.activeTransactionUpdates);
    return result;
  }

  async findPage(
    envelope: (typeof PERSONAL_DATA_ENVELOPES)[number],
    from: number,
    afterId: string | undefined,
    take: number
  ): Promise<PersonalDataEnvelopeRow[]> {
    this.pages.push(take);
    return (this.rows.get(envelopeKey(envelope)) ?? [])
      .filter(
        (row) =>
          row.keyVersion === from && (afterId === undefined || row.id > afterId)
      )
      .sort(
        (left, right) =>
          left.keyVersion - right.keyVersion || left.id.localeCompare(right.id)
      )
      .slice(0, take)
      .map((row) => ({ ...row }));
  }

  async compareAndSet(
    envelope: (typeof PERSONAL_DATA_ENVELOPES)[number],
    id: string,
    oldVersion: number,
    replacement: Omit<PersonalDataEnvelopeRow, "id" | "ownerId">
  ): Promise<boolean> {
    this.activeTransactionUpdates += 1;
    if (this.contendIds.has(id)) return false;
    const row = (this.rows.get(envelopeKey(envelope)) ?? []).find(
      (candidate) => candidate.id === id
    );
    if (!row || row.keyVersion !== oldVersion) return false;
    Object.assign(row, replacement);
    this.updates += 1;
    return true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function envelopeKey(
  envelope: (typeof PERSONAL_DATA_ENVELOPES)[number]
): string {
  return `${envelope.model}.${envelope.name}`;
}

describe("personal data rekey command", () => {
  it("registers exactly every Migration 1 calendar and location envelope", () => {
    expect(
      PERSONAL_DATA_ENVELOPES.map(({ model, name, purpose }) => [
        model,
        name,
        purpose,
      ])
    ).toEqual([
      ["GoogleOAuthAttempt", "pkce", "google-oauth-pkce"],
      [
        "GoogleCalendarConnection",
        "refreshToken",
        "google-calendar-refresh-token",
      ],
      [
        "GoogleCalendarConnection",
        "calendarListSyncToken",
        "google-calendar-list-sync-token",
      ],
      ["CalendarSource", "externalId", "calendar-source-external-id"],
      ["CalendarSource", "name", "calendar-source-name"],
      ["CalendarSource", "syncToken", "calendar-source-sync-token"],
      ["CalendarWatch", "resourceId", "calendar-watch-resource-id"],
      ["CalendarEvent", "externalEventId", "calendar-event-external-id"],
      ["CalendarEvent", "recurringEventId", "calendar-event-recurring-id"],
      ["CalendarEvent", "details", "calendar-event-details"],
      ["LocationDevice", "name", "location-device-name"],
      ["LocationDevice", "externalDeviceId", "location-device-external-id"],
      ["LocationSample", "coordinates", "location-sample-coordinates"],
      ["DerivedVisit", "centroid", "derived-visit-centroid"],
      ["LocationAlias", "alias", "location-alias"],
    ]);
  });

  it.each([
    { args: [] },
    { args: ["--from=1"] },
    { args: ["--from=1", "--to=2", "--unknown"] },
    { args: ["--from=0", "--to=2"] },
    { args: ["--from=1.5", "--to=2"] },
    { args: ["--from=1", "--to=-2"] },
    { args: ["--from=1", "--to=1"] },
    { args: ["--from=1", "--to=2", "--batch-size=0"] },
    { args: ["--from=1", "--to=2", "--batch-size=501"] },
    { args: ["--from=1", "--from=2", "--to=3"] },
  ])("rejects invalid arguments $args", ({ args }) => {
    expect(() => parseRekeyArguments(args)).toThrow("invalid_arguments");
  });

  it("parses positive distinct versions and a conservative batch bound", () => {
    expect(
      parseRekeyArguments([
        "--from=1",
        "--to=2",
        "--batch-size=500",
        "--dry-run",
      ])
    ).toEqual({ from: 1, to: 2, batchSize: 500, dryRun: true });
  });

  it.each([
    [3, 2],
    [1, 3],
  ])(
    "fails before scanning when key version %i or %i is unavailable",
    async (from, to) => {
      const store = new MemoryRekeyStore();
      const cipher = new PersonalDataCipherService(config());

      await expect(
        runPersonalDataRekey(
          { from, to, batchSize: 10, dryRun: false },
          store,
          cipher
        )
      ).rejects.toThrow("invalid_key_versions");
      expect(store.pages).toEqual([]);
      expect(store.closed).toBe(true);
    }
  );

  it("dry-run counts every envelope without decrypting or updating", async () => {
    const store = new MemoryRekeyStore();
    const cipher = new PersonalDataCipherService(config());
    PERSONAL_DATA_ENVELOPES.forEach((_envelope, index) => {
      store.seed(index, [encryptedRow(cipher, index, `row-${index}`)]);
    });
    const reencrypt = jest.spyOn(cipher, "reencryptToVersion");
    const lines: string[] = [];

    const result = await runPersonalDataRekey(
      { from: 1, to: 2, batchSize: 10, dryRun: true },
      store,
      cipher,
      (line) => lines.push(line)
    );

    expect(result).toEqual({ scanned: 15, rekeyed: 0, contended: 0 });
    expect(reencrypt).not.toHaveBeenCalled();
    expect(store.pages).toEqual([]);
    expect(store.updates).toBe(0);
    expect(lines).toHaveLength(16);
    expect(lines[0]).toBe(
      "registry=personal-data model=GoogleOAuthAttempt envelope=pkce scanned=1 rekeyed=0 contended=0"
    );
    expect(store.closed).toBe(true);
  });

  it("re-encrypts every registered Migration 1 envelope to the explicit target", async () => {
    const store = new MemoryRekeyStore();
    const cipher = new PersonalDataCipherService(config());
    PERSONAL_DATA_ENVELOPES.forEach((_envelope, index) => {
      store.seed(index, [encryptedRow(cipher, index, `row-${index}`)]);
    });

    const result = await runPersonalDataRekey(
      { from: 1, to: 2, batchSize: 10, dryRun: false },
      store,
      cipher
    );

    expect(result).toEqual({ scanned: 15, rekeyed: 15, contended: 0 });
    PERSONAL_DATA_ENVELOPES.forEach((envelope, index) => {
      const row = store.rows.get(envelopeKey(envelope))?.[0];
      expect(row?.keyVersion).toBe(2);
      expect(
        cipher.decrypt(envelope.purpose, row!.ownerId, row!.id, row!)
      ).toBe(`synthetic-value-${index}-row-${index}`);
    });
  });

  it("pages by source version and id in bounded transactions", async () => {
    const store = new MemoryRekeyStore();
    const cipher = new PersonalDataCipherService(config());
    store.seed(
      0,
      ["a", "b", "c", "d", "e"].map((id) => encryptedRow(cipher, 0, id))
    );

    const result = await runPersonalDataRekey(
      { from: 1, to: 2, batchSize: 2, dryRun: false },
      store,
      cipher
    );

    expect(result).toEqual({ scanned: 5, rekeyed: 5, contended: 0 });
    expect(store.pages.slice(0, 3)).toEqual([2, 2, 2]);
    expect(store.transactionSizes.slice(0, 3)).toEqual([2, 2, 1]);
    expect(store.transactionSizes.every((size) => size <= 2)).toBe(true);
    expect(
      store.rows.get("GoogleOAuthAttempt.pkce")?.map((row) => row.keyVersion)
    ).toEqual([2, 2, 2, 2, 2]);
  });

  it("normalizes Prisma byte arrays and issues an exact version-id page query", async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      {
        id: "row",
        ownerId: "owner",
        ciphertext: new Uint8Array([1]),
        iv: new Uint8Array(12),
        tag: new Uint8Array(16),
        keyVersion: 1,
      },
    ]);
    const prisma = {
      $transaction: jest.fn(async (callback) =>
        callback({ $queryRawUnsafe: queryRaw })
      ),
      $disconnect: jest.fn(),
    } as unknown as PrismaClient;
    const store = new PrismaPersonalDataRekeyStore(prisma);

    const rows = await store.transaction((transaction) =>
      transaction.findPage(PERSONAL_DATA_ENVELOPES[0], 1, "cursor", 10)
    );

    expect(Buffer.isBuffer(rows[0].ciphertext)).toBe(true);
    expect(Buffer.isBuffer(rows[0].iv)).toBe(true);
    expect(Buffer.isBuffer(rows[0].tag)).toBe(true);
    expect(queryRaw.mock.calls[0][0]).toContain(
      'AND ("pkceKeyVersion", "id") > ($1, $2)'
    );
    expect(queryRaw.mock.calls[0][0]).toContain(
      'ORDER BY "pkceKeyVersion", "id"'
    );
    expect(queryRaw.mock.calls[0].slice(1)).toEqual([1, "cursor", 10]);
    expect((prisma.$transaction as jest.Mock).mock.calls[0][1]).toEqual({
      maxWait: 10_000,
      timeout: 120_000,
    });
  });

  it("issues compare-and-set SQL with Buffer values and the old key version", async () => {
    const executeRaw = jest.fn().mockResolvedValue(1);
    const prisma = {
      $transaction: jest.fn(async (callback) =>
        callback({ $executeRawUnsafe: executeRaw })
      ),
      $disconnect: jest.fn(),
    } as unknown as PrismaClient;
    const store = new PrismaPersonalDataRekeyStore(prisma);
    const replacement = {
      ciphertext: Buffer.from([1, 2, 3]),
      iv: Buffer.alloc(12, 4),
      tag: Buffer.alloc(16, 5),
      keyVersion: 2,
    };

    const updated = await store.transaction((transaction) =>
      transaction.compareAndSet(
        PERSONAL_DATA_ENVELOPES[0],
        "synthetic-row",
        1,
        replacement
      )
    );

    expect(updated).toBe(true);
    expect(executeRaw.mock.calls[0][0]).toContain(
      'WHERE "id" = $5 AND "pkceKeyVersion" = $6'
    );
    expect(executeRaw.mock.calls[0].slice(1)).toEqual([
      replacement.ciphertext,
      replacement.iv,
      replacement.tag,
      2,
      "synthetic-row",
      1,
    ]);
    expect(executeRaw.mock.calls[0].slice(1, 4).every(Buffer.isBuffer)).toBe(
      true
    );
  });

  it("uses compare-and-set and reports contention without overwriting", async () => {
    const store = new MemoryRekeyStore();
    const cipher = new PersonalDataCipherService(config());
    const original = encryptedRow(cipher, 0, "contended");
    store.seed(0, [original]);
    store.contendIds.add("contended");

    const result = await runPersonalDataRekey(
      { from: 1, to: 2, batchSize: 10, dryRun: false },
      store,
      cipher
    );

    expect(result).toEqual({ scanned: 1, rekeyed: 0, contended: 1 });
    expect(store.rows.get("GoogleOAuthAttempt.pkce")?.[0]).toEqual(original);
  });

  it("recovers a contended source-version row behind the cursor on a fresh invocation", async () => {
    const store = new MemoryRekeyStore();
    const cipher = new PersonalDataCipherService(config());
    store.seed(
      0,
      ["a", "b", "c"].map((id) => encryptedRow(cipher, 0, id))
    );
    store.contendIds.add("a");

    const first = await runPersonalDataRekey(
      { from: 1, to: 2, batchSize: 2, dryRun: false },
      store,
      cipher
    );

    expect(first).toEqual({ scanned: 3, rekeyed: 2, contended: 1 });
    expect(
      store.rows.get("GoogleOAuthAttempt.pkce")?.map((row) => row.keyVersion)
    ).toEqual([1, 2, 2]);

    const resumedStore = new MemoryRekeyStore();
    resumedStore.seed(0, store.rows.get("GoogleOAuthAttempt.pkce")!);
    const resumed = await runPersonalDataRekey(
      { from: 1, to: 2, batchSize: 2, dryRun: false },
      resumedStore,
      cipher
    );

    expect(resumed).toEqual({ scanned: 1, rekeyed: 1, contended: 0 });
    expect(
      resumedStore.rows
        .get("GoogleOAuthAttempt.pkce")
        ?.map((row) => row.keyVersion)
    ).toEqual([2, 2, 2]);
  });

  it("excludes nullable envelopes without decrypting or updating", async () => {
    const store = new MemoryRekeyStore();
    const cipher = new PersonalDataCipherService(config());
    const nullableRow = {
      id: "nullable-row",
      ownerId: "synthetic-owner",
      ciphertext: null,
      iv: null,
      tag: null,
      keyVersion: null,
    } as unknown as PersonalDataEnvelopeRow;
    store.seed(2, [nullableRow]);
    const reencrypt = jest.spyOn(cipher, "reencryptToVersion");

    const result = await runPersonalDataRekey(
      { from: 1, to: 2, batchSize: 10, dryRun: false },
      store,
      cipher
    );

    expect(result).toEqual({ scanned: 0, rekeyed: 0, contended: 0 });
    expect(reencrypt).not.toHaveBeenCalled();
    expect(store.updates).toBe(0);
  });

  it("resumes after interruption using only remaining source-version rows", async () => {
    const store = new MemoryRekeyStore();
    const cipher = new PersonalDataCipherService(config());
    store.seed(
      0,
      ["a", "b", "c"].map((id) => encryptedRow(cipher, 0, id))
    );
    store.interruptTransaction = 2;

    await expect(
      runPersonalDataRekey(
        { from: 1, to: 2, batchSize: 2, dryRun: false },
        store,
        cipher
      )
    ).rejects.toThrow("synthetic-sensitive-interruption");
    expect(
      store.rows.get("GoogleOAuthAttempt.pkce")?.map((row) => row.keyVersion)
    ).toEqual([2, 2, 1]);

    store.interruptTransaction = undefined;
    const result = await runPersonalDataRekey(
      { from: 1, to: 2, batchSize: 2, dryRun: false },
      store,
      cipher
    );
    expect(result).toEqual({ scanned: 1, rekeyed: 1, contended: 0 });
    expect(
      store.rows.get("GoogleOAuthAttempt.pkce")?.map((row) => row.keyVersion)
    ).toEqual([2, 2, 2]);
  });

  it("emits aggregate-only output and redacts unexpected failures", async () => {
    const store = new MemoryRekeyStore();
    const cipher = new PersonalDataCipherService(config());
    store.seed(0, [encryptedRow(cipher, 0, "synthetic-sensitive-row-id")]);
    const lines: string[] = [];

    await runPersonalDataRekey(
      { from: 1, to: 2, batchSize: 10, dryRun: false },
      store,
      cipher,
      (line) => lines.push(line)
    );

    const output = lines.join("\n");
    expect(output).toMatch(
      /^registry=personal-data model=[A-Za-z]+ envelope=[A-Za-z]+ scanned=\d+ rekeyed=\d+ contended=\d+(\n|$)/
    );
    expect(output).not.toContain("synthetic-sensitive-row-id");
    expect(output).not.toContain("synthetic-value");
    expect(output).not.toContain("google-oauth-pkce");
    expect(safeRekeyFailureCode(new Error("synthetic-sensitive-error"))).toBe(
      "rekey_failed"
    );
  });
});
