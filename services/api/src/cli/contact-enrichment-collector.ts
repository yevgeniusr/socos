import { execFile } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Prisma } from "@prisma/client";
import { canonicalJson } from "../modules/agent-security/canonical-json.js";
import {
  ENRICHMENT_FIELDS,
  type EnrichmentField,
  type EnrichmentSourceKind,
} from "../modules/contact-enrichment/contact-enrichment.types.js";
import { normalizeCandidateValue } from "../modules/contact-enrichment/contact-enrichment.validation.js";

const execFileAsync = promisify(execFile);
const SECRET_NAME =
  /(?:^|[._ -])(secret|password|credential|token|private[._ -]?key)s?(?:[._ -]|$)/i;
const DATA_BROKER_HOST =
  /(?:^|\.)(?:spokeo|whitepages|beenverified|peoplefinder|truthfinder|radaris)\.com$/i;
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

export interface CollectorContact {
  id: string;
  firstName: string;
  lastName?: string | null;
  nickname?: string | null;
  aliases?: string[];
}

export interface CollectorCandidate {
  contactId: string;
  fieldName: EnrichmentField;
  proposedValue: Prisma.JsonValue;
  sourceKind: EnrichmentSourceKind;
  sourceLocator: string;
  sourceReference?: string;
  sourceRetrievedAt: string;
  confidence: number;
  matchRationale: string;
}

export interface MarkdownDocument {
  locator: string;
  content: string;
  retrievedAt: string;
}

export interface PublicResult {
  contactId?: string;
  name?: string;
  fieldName: string;
  proposedValue: Prisma.JsonValue;
  sourceLocator: string;
  sourceReference?: string;
  retrievedAt: string;
  matchRationale?: string;
}

export interface ArcHistoryRow {
  url: string;
  title: string;
}

interface ArcHistoryDependencies {
  makeTempDir(prefix: string): Promise<string>;
  copyFile(source: string, target: string): Promise<void>;
  queryHistory(databasePath: string): Promise<ArcHistoryRow[]>;
  removeTempDir(directory: string): Promise<void>;
}

export function collectFromMarkdownDocuments(
  contacts: readonly CollectorContact[],
  documents: readonly MarkdownDocument[]
): CollectorCandidate[] {
  const candidates: CollectorCandidate[] = [];
  for (const document of [...documents].sort((a, b) =>
    a.locator.localeCompare(b.locator)
  )) {
    const labels = labeledLines(document.content);
    const names = labels
      .filter((line) => line.key === "name")
      .map((line) => line.value);
    const fallback = path
      .basename(document.locator, path.extname(document.locator))
      .replace(/[-_]+/g, " ");
    const contact = uniqueNameMatch(contacts, names[0] ?? fallback);
    if (!contact) continue;
    const matchRationale = names[0]
      ? "Exact contact name or alias matched an explicitly labeled Markdown record."
      : "Exact contact name or alias matched the Markdown filename.";
    const socialLinks: Record<string, string> = {};
    const socialReferences: string[] = [];

    for (const line of labels) {
      const mapped = markdownField(line.key, line.value);
      if (!mapped) continue;
      if (mapped.fieldName === "socialLinks") {
        Object.assign(socialLinks, mapped.proposedValue);
        socialReferences.push(`line:${line.line}:${line.key}`);
        continue;
      }
      addValidCandidate(candidates, {
        contactId: contact.id,
        ...mapped,
        sourceKind: "second_brain",
        sourceLocator: document.locator,
        sourceReference: `line:${line.line}:${line.key}`,
        sourceRetrievedAt: document.retrievedAt,
        confidence: 0.97,
        matchRationale,
      });
    }
    if (Object.keys(socialLinks).length > 0) {
      addValidCandidate(candidates, {
        contactId: contact.id,
        fieldName: "socialLinks",
        proposedValue: socialLinks,
        sourceKind: "second_brain",
        sourceLocator: document.locator,
        sourceReference: socialReferences.join(",").slice(0, 500),
        sourceRetrievedAt: document.retrievedAt,
        confidence: 0.95,
        matchRationale,
      });
    }
  }
  return stableCandidates(candidates);
}

export function collectFromVCard(
  contacts: readonly CollectorContact[],
  source: string,
  locator: string,
  retrievedAt: string
): CollectorCandidate[] {
  const unfolded = source.replace(/\r?\n[ \t]/g, "");
  const cards = unfolded.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) ?? [];
  const candidates: CollectorCandidate[] = [];
  for (const card of cards) {
    const properties = vcardProperties(card);
    const name = properties.get("FN")?.[0];
    if (!name) continue;
    const contact = uniqueNameMatch(contacts, name);
    if (!contact) continue;
    const rationale =
      "Exact full-name or alias match in an explicitly exported vCard.";
    const fieldValues: Array<[EnrichmentField, Prisma.JsonValue, string]> = [];
    const birthday = properties.get("BDAY")?.[0];
    if (birthday) {
      const value = parseBirthday(birthday);
      if (value) fieldValues.push(["birthday", value, "BDAY"]);
    }
    const org = properties.get("ORG")?.[0]?.split(";")[0];
    if (org) fieldValues.push(["company", unescapeVcard(org), "ORG"]);
    const title = properties.get("TITLE")?.[0];
    if (title) fieldValues.push(["jobTitle", unescapeVcard(title), "TITLE"]);
    const photo = properties
      .get("PHOTO")
      ?.find((value) => /^https:\/\//i.test(value));
    if (photo) fieldValues.push(["photo", photo, "PHOTO"]);
    const website = properties
      .get("URL")
      ?.find((value) => /^https:\/\//i.test(value));
    if (website) fieldValues.push(["socialLinks", { website }, "URL"]);

    for (const [fieldName, proposedValue, reference] of fieldValues) {
      addValidCandidate(candidates, {
        contactId: contact.id,
        fieldName,
        proposedValue,
        sourceKind: "vcard",
        sourceLocator: locator,
        sourceReference: reference,
        sourceRetrievedAt: retrievedAt,
        confidence: 0.99,
        matchRationale: rationale,
      });
    }
  }
  return stableCandidates(candidates);
}

export function collectFromPublicResults(
  contacts: readonly CollectorContact[],
  results: readonly PublicResult[]
): CollectorCandidate[] {
  const candidates: CollectorCandidate[] = [];
  for (const result of results) {
    if (!ENRICHMENT_FIELDS.includes(result.fieldName as EnrichmentField))
      continue;
    if (!safePublicEvidenceLocator(result.sourceLocator)) continue;
    const explicit = result.contactId
      ? contacts.find((contact) => contact.id === result.contactId)
      : undefined;
    const contact =
      explicit ?? (result.name ? uniqueNameMatch(contacts, result.name) : null);
    if (!contact) continue;
    const confidence = explicit
      ? 0.6
      : result.fieldName === "socialLinks"
        ? 0.5
        : 0.35;
    addValidCandidate(candidates, {
      contactId: contact.id,
      fieldName: result.fieldName as EnrichmentField,
      proposedValue: result.proposedValue,
      sourceKind: "public_web",
      sourceLocator: result.sourceLocator,
      sourceReference: result.sourceReference,
      sourceRetrievedAt: result.retrievedAt,
      confidence,
      matchRationale:
        result.matchRationale?.trim() ||
        (explicit
          ? "Operator supplied an explicit Socos contact id; public evidence still requires human review."
          : "Unique exact name match only; public evidence requires human review."),
    });
  }
  return stableCandidates(candidates);
}

export function collectFromArcRows(
  contacts: readonly CollectorContact[],
  rows: readonly ArcHistoryRow[],
  sourceKind: "arc_history" | "arc_sidebar",
  locator: string,
  retrievedAt: string
): CollectorCandidate[] {
  const candidates: CollectorCandidate[] = [];
  for (const row of rows.slice(0, 50_000)) {
    const titleMatch = uniqueNameMatch(contacts, row.title);
    const social = socialProfile(row.url);
    const profile = social ?? (titleMatch ? "website" : null);
    if (!profile) continue;
    const slug =
      new URL(row.url).pathname
        .split("/")
        .filter(Boolean)
        .pop()
        ?.replace(/[-_.]+/g, " ") ?? "";
    const slugMatch = social ? uniqueNameMatch(contacts, slug) : null;
    const contact = titleMatch ?? slugMatch;
    if (!contact) continue;
    addValidCandidate(candidates, {
      contactId: contact.id,
      fieldName: "socialLinks",
      proposedValue: { [profile]: row.url },
      sourceKind,
      sourceLocator: locator,
      sourceReference: titleMatch ? "exact-title" : "exact-profile-slug",
      sourceRetrievedAt: retrievedAt,
      confidence: titleMatch ? 0.92 : 0.8,
      matchRationale: titleMatch
        ? "Arc public profile URL had an exact contact name or alias in its title."
        : "Arc public profile URL slug exactly matched a contact name or alias.",
    });
  }
  return stableCandidates(candidates);
}

export async function readCopiedArcHistory(
  source: string,
  dependencies: ArcHistoryDependencies = defaultArcDependencies
): Promise<ArcHistoryRow[]> {
  assertSafeArcSource(source);
  const directory = await dependencies.makeTempDir(
    path.join(os.tmpdir(), "socos-arc-history-")
  );
  const copy = path.join(directory, "History.sqlite");
  try {
    await dependencies.copyFile(source, copy);
    return await dependencies.queryHistory(copy);
  } finally {
    await dependencies.removeTempDir(directory);
  }
}

export function assertSafeArcSource(source: string): void {
  if (path.basename(source) !== "History") throw new Error("Unsafe Arc source");
  const normalized = source.replace(/\\/g, "/");
  if (!/\/User Data\/[^/]+\/History$/.test(normalized)) {
    throw new Error("Unsafe Arc source");
  }
}

export function isAllowedMarkdownPath(source: string): boolean {
  const normalized = source.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return (
    path.extname(source).toLowerCase() === ".md" &&
    !segments.some((segment) => segment.startsWith(".")) &&
    !segments.some((segment) => SECRET_NAME.test(segment)) &&
    !segments.includes("node_modules")
  );
}

export function stableCandidateJsonl(
  candidates: readonly CollectorCandidate[]
): string {
  const rows = stableCandidates(candidates).map((candidate) =>
    JSON.stringify(candidate)
  );
  return rows.length ? `${rows.join("\n")}\n` : "";
}

export async function runCollectorCli(
  argv = process.argv.slice(2)
): Promise<void> {
  const options = parseArgs(argv);
  if (!options.contacts) throw new Error("--contacts is required");
  const contacts = parseContacts(
    await readBoundedText(options.contacts, 10 * MAX_TEXT_FILE_BYTES)
  );
  const candidates: CollectorCandidate[] = [];

  if (options.secondBrain) {
    const documents = await readMarkdownDocuments(options.secondBrain);
    candidates.push(...collectFromMarkdownDocuments(contacts, documents));
  }
  if (options.vcard) {
    if (path.extname(options.vcard).toLowerCase() !== ".vcf") {
      throw new Error("Apple Contacts input must be an explicit .vcf export");
    }
    const sourceStat = await stat(options.vcard);
    candidates.push(
      ...collectFromVCard(
        contacts,
        await readBoundedText(options.vcard, 10 * MAX_TEXT_FILE_BYTES),
        options.vcard,
        sourceStat.mtime.toISOString()
      )
    );
  }
  if (options.publicResults) {
    const lines = (
      await readBoundedText(options.publicResults, 10 * MAX_TEXT_FILE_BYTES)
    )
      .split(/\r?\n/)
      .filter(Boolean);
    if (lines.length > 10_000)
      throw new Error("Public result input is too large");
    const results = lines.map((line) => JSON.parse(line) as PublicResult);
    candidates.push(...collectFromPublicResults(contacts, results));
  }
  if (options.arc) {
    const arcCandidates = await collectArcPath(contacts, options.arc);
    candidates.push(...arcCandidates);
  }

  const output = stableCandidateJsonl(candidates);
  if (options.output) await writeFile(options.output, output, "utf8");
  else process.stdout.write(output);
  const stable = stableCandidates(candidates);
  const report = {
    dryRun: true,
    contacts: contacts.length,
    candidates: stable.length,
    bySource: countBy(stable, "sourceKind"),
    byField: countBy(stable, "fieldName"),
  };
  process.stderr.write(`${JSON.stringify(report)}\n`);
}

const defaultArcDependencies: ArcHistoryDependencies = {
  makeTempDir: (prefix) => mkdtemp(prefix),
  copyFile,
  queryHistory: async (databasePath) => {
    const { stdout } = await execFileAsync("sqlite3", [
      "-readonly",
      "-json",
      databasePath,
      "SELECT url, title FROM urls WHERE url LIKE 'https://%' ORDER BY url ASC, title ASC LIMIT 50000;",
    ]);
    const parsed = stdout.trim() ? JSON.parse(stdout) : [];
    if (!Array.isArray(parsed))
      throw new Error("Invalid Arc History query result");
    return parsed.flatMap((row) =>
      row && typeof row.url === "string" && typeof row.title === "string"
        ? [{ url: row.url, title: row.title }]
        : []
    );
  },
  removeTempDir: (directory) => rm(directory, { recursive: true, force: true }),
};

async function collectArcPath(
  contacts: readonly CollectorContact[],
  source: string
): Promise<CollectorCandidate[]> {
  const sourceStat = await stat(source);
  if (sourceStat.isFile()) {
    assertSafeArcSource(source);
    return collectFromArcRows(
      contacts,
      await readCopiedArcHistory(source),
      "arc_history",
      source,
      sourceStat.mtime.toISOString()
    );
  }
  const files = await walk(source, 4);
  const candidates: CollectorCandidate[] = [];
  for (const file of files.sort()) {
    if (path.basename(file) === "History") {
      try {
        assertSafeArcSource(file);
      } catch {
        continue;
      }
      const fileStat = await stat(file);
      candidates.push(
        ...collectFromArcRows(
          contacts,
          await readCopiedArcHistory(file),
          "arc_history",
          file,
          fileStat.mtime.toISOString()
        )
      );
      continue;
    }
    if (!isArcPublicJson(file)) continue;
    const fileStat = await stat(file);
    const rows = publicUrlTitlePairs(
      JSON.parse(await readBoundedText(file, 10 * MAX_TEXT_FILE_BYTES))
    );
    candidates.push(
      ...collectFromArcRows(
        contacts,
        rows,
        "arc_sidebar",
        file,
        fileStat.mtime.toISOString()
      )
    );
  }
  return stableCandidates(candidates);
}

async function readMarkdownDocuments(
  root: string
): Promise<MarkdownDocument[]> {
  const files = (await walk(root, 12)).filter((file) =>
    isAllowedMarkdownPath(path.relative(root, file))
  );
  const documents: MarkdownDocument[] = [];
  for (const file of files.sort()) {
    const fileStat = await stat(file);
    if (fileStat.size > MAX_TEXT_FILE_BYTES) continue;
    documents.push({
      locator: path.relative(root, file),
      content: await readFile(file, "utf8"),
      retrievedAt: fileStat.mtime.toISOString(),
    });
  }
  return documents;
}

async function walk(
  root: string,
  maxDepth: number,
  depth = 0
): Promise<string[]> {
  if (depth > maxDepth) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (
      entry.isSymbolicLink() ||
      entry.name === "node_modules" ||
      entry.name === ".git"
    )
      continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory())
      files.push(...(await walk(target, maxDepth, depth + 1)));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function labeledLines(content: string) {
  return content.split(/\r?\n/).flatMap((raw, index) => {
    const match = raw.match(
      /^\s*(?:[-*]\s*)?([A-Za-z][A-Za-z ]{1,30}):\s*(.+?)\s*$/
    );
    if (!match) return [];
    return [
      {
        key: match[1].trim().toLowerCase(),
        value: match[2].trim().replace(/^['"]|['"]$/g, ""),
        line: index + 1,
      },
    ];
  });
}

function markdownField(
  key: string,
  value: string
): Pick<CollectorCandidate, "fieldName" | "proposedValue"> | null {
  if (["company", "organization", "org"].includes(key))
    return { fieldName: "company", proposedValue: value };
  if (["title", "job title"].includes(key))
    return { fieldName: "jobTitle", proposedValue: value };
  if (key === "bio") return { fieldName: "bio", proposedValue: value };
  if (key === "birthday") {
    const parsed = parseBirthday(value);
    return parsed ? { fieldName: "birthday", proposedValue: parsed } : null;
  }
  if (key === "anniversary")
    return { fieldName: "anniversary", proposedValue: value };
  if (key === "first met date")
    return { fieldName: "firstMetDate", proposedValue: value };
  if (key === "first met context")
    return { fieldName: "firstMetContext", proposedValue: value };
  if (key === "photo") return { fieldName: "photo", proposedValue: value };
  if (
    [
      "linkedin",
      "twitter",
      "x",
      "instagram",
      "github",
      "facebook",
      "website",
    ].includes(key)
  ) {
    return { fieldName: "socialLinks", proposedValue: { [key]: value } };
  }
  return null;
}

function parseBirthday(value: string): Prisma.JsonValue | null {
  const normalized = value.trim();
  const partial = normalized.match(/^--(\d{2})-?(\d{2})$/);
  if (partial) return { month: Number(partial[1]), day: Number(partial[2]) };
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function vcardProperties(card: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const line of card.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).split(";", 1)[0].toUpperCase();
    const value = line.slice(separator + 1).trim();
    if (!value) continue;
    result.set(key, [...(result.get(key) ?? []), value]);
  }
  return result;
}

function unescapeVcard(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\([,;\\])/g, "$1")
    .trim();
}

function uniqueNameMatch(
  contacts: readonly CollectorContact[],
  name: string
): CollectorContact | null {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  const matches = contacts.filter((contact) =>
    contactNames(contact).includes(normalized)
  );
  return matches.length === 1 ? matches[0] : null;
}

function contactNames(contact: CollectorContact): string[] {
  return [
    [contact.firstName, contact.lastName].filter(Boolean).join(" "),
    contact.nickname,
    ...(contact.aliases ?? []),
  ].flatMap((name) => (name ? [normalizeName(name)] : []));
}

function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function addValidCandidate(
  candidates: CollectorCandidate[],
  candidate: CollectorCandidate
): void {
  try {
    const normalized = normalizeCandidateValue(
      candidate.fieldName,
      candidate.proposedValue
    );
    candidates.push({ ...candidate, proposedValue: normalized });
  } catch {
    // Invalid labeled data is omitted, never repaired or guessed.
  }
}

function stableCandidates(
  candidates: readonly CollectorCandidate[]
): CollectorCandidate[] {
  const byKey = new Map<string, CollectorCandidate>();
  for (const candidate of candidates) {
    const key = canonicalJson({
      ...candidate,
      sourceReference: candidate.sourceReference ?? null,
    });
    byKey.set(key, candidate);
  }
  return [...byKey.values()].sort((a, b) =>
    [
      a.contactId,
      a.fieldName,
      a.sourceKind,
      a.sourceLocator,
      a.sourceReference ?? "",
      canonicalJson(a.proposedValue),
    ]
      .join("\0")
      .localeCompare(
        [
          b.contactId,
          b.fieldName,
          b.sourceKind,
          b.sourceLocator,
          b.sourceReference ?? "",
          canonicalJson(b.proposedValue),
        ].join("\0")
      )
  );
}

function safePublicEvidenceLocator(locator: string): boolean {
  try {
    const normalized = normalizeCandidateValue("photo", locator) as string;
    const url = new URL(normalized);
    return !DATA_BROKER_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

function socialProfile(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host === "linkedin.com" || host === "www.linkedin.com")
      return "linkedin";
    if (["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(host))
      return "twitter";
    if (host === "instagram.com" || host === "www.instagram.com")
      return "instagram";
    if (host === "github.com" || host === "www.github.com") return "github";
    if (host === "facebook.com" || host === "www.facebook.com")
      return "facebook";
    return null;
  } catch {
    return null;
  }
}

export function isArcPublicJson(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  return ["storablesidebar.json", "storablearchiveitems.json"].includes(base);
}

export function publicUrlTitlePairs(value: unknown): ArcHistoryRow[] {
  const rows: ArcHistoryRow[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return void node.forEach(visit);
    const record = node as Record<string, unknown>;
    for (const [urlKey, titleKey] of [
      ["url", "title"],
      ["savedURL", "savedTitle"],
    ] as const) {
      const url = record[urlKey];
      const title = record[titleKey];
      if (
        typeof url === "string" &&
        typeof title === "string" &&
        safePublicEvidenceLocator(url)
      ) {
        rows.push({ url, title });
      }
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return rows.sort((a, b) =>
    `${a.url}\0${a.title}`.localeCompare(`${b.url}\0${b.title}`)
  );
}

function parseContacts(value: string): CollectorContact[] {
  const parsed = JSON.parse(value);
  const rows = Array.isArray(parsed) ? parsed : parsed?.contacts;
  if (!Array.isArray(rows))
    throw new Error("Contacts export must be an array or {contacts: []}");
  return rows.map((row) => {
    if (
      !row ||
      typeof row.id !== "string" ||
      typeof row.firstName !== "string"
    ) {
      throw new Error("Invalid contact export row");
    }
    return {
      id: row.id,
      firstName: row.firstName,
      lastName: typeof row.lastName === "string" ? row.lastName : null,
      nickname: typeof row.nickname === "string" ? row.nickname : null,
      aliases: Array.isArray(row.aliases)
        ? row.aliases.filter((item: unknown) => typeof item === "string")
        : [],
    };
  });
}

async function readBoundedText(
  file: string,
  maxBytes: number
): Promise<string> {
  const fileStat = await stat(file);
  if (!fileStat.isFile() || fileStat.size > maxBytes)
    throw new Error("Input file is too large or invalid");
  return readFile(file, "utf8");
}

function parseArgs(
  argv: readonly string[]
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  const names: Record<string, string> = {
    "--contacts": "contacts",
    "--second-brain": "secondBrain",
    "--arc": "arc",
    "--vcard": "vcard",
    "--public-results": "publicResults",
    "--output": "output",
  };
  for (let index = 0; index < argv.length; index += 2) {
    const key = names[argv[index]];
    const value = argv[index + 1];
    if (!key || !value || value.startsWith("--"))
      throw new Error(`Invalid argument: ${argv[index]}`);
    result[key] = value;
  }
  return result;
}

function countBy(
  candidates: readonly CollectorCandidate[],
  key: "sourceKind" | "fieldName"
) {
  return Object.fromEntries(
    [...new Set(candidates.map((candidate) => candidate[key]))]
      .sort()
      .map((value) => [
        value,
        candidates.filter((candidate) => candidate[key] === value).length,
      ])
  );
}

if (require.main === module) {
  runCollectorCli().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Collector failed"}\n`
    );
    process.exitCode = 1;
  });
}
