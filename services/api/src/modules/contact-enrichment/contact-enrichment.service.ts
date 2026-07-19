import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { hashCanonicalJson } from "../agent-security/canonical-json.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type {
  CorrectSocialLinkInput,
  EnrichmentField,
  EnrichmentPageInput,
  SubmitEnrichmentCandidateInput,
} from "./contact-enrichment.types.js";
import { normalizeCandidateValue } from "./contact-enrichment.validation.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const AUTO_ACCEPT_CONFIDENCE = 0.9;
const AUTOMATIC_CORRECTION_SOURCE_KINDS = new Set([
  "second_brain",
  "arc_history",
  "arc_sidebar",
  "vcard",
]);
const SOCIAL_KEY_PROBE_URLS: Readonly<Record<string, string>> = {
  linkedin: "https://www.linkedin.com/in/example/",
  twitter: "https://twitter.com/example",
  x: "https://x.com/example",
  instagram: "https://www.instagram.com/example/",
  github: "https://github.com/example",
  facebook: "https://www.facebook.com/example",
  website: "https://example.org/",
};

type EnrichmentClient = Pick<
  Prisma.TransactionClient,
  "contact" | "contactEnrichmentCandidate"
>;

type SocialCorrectionClient = Pick<
  Prisma.TransactionClient,
  "contact" | "contactEnrichmentCandidate"
>;

@Injectable()
export class ContactEnrichmentService {
  constructor(private readonly prisma: PrismaService) {}

  async listIncomplete(ownerId: string, page: EnrichmentPageInput = {}) {
    const { offset, limit } = normalizePage(page);
    const where: Prisma.ContactWhereInput = {
      ownerId,
      isDemo: false,
      OR: [
        { photo: null },
        { photo: "" },
        { bio: null },
        { bio: "" },
        { company: null },
        { company: "" },
        { jobTitle: null },
        { jobTitle: "" },
        {
          AND: [
            { birthday: null },
            { OR: [{ birthdayMonth: null }, { birthdayDay: null }] },
          ],
        },
        { anniversary: null },
        { socialLinks: { equals: Prisma.DbNull } },
        { socialLinks: { equals: {} } },
        { firstMetDate: null },
        { firstMetContext: null },
        { firstMetContext: "" },
      ],
    };
    const select = {
      id: true,
      firstName: true,
      lastName: true,
      photo: true,
      bio: true,
      company: true,
      jobTitle: true,
      birthday: true,
      birthdayMonth: true,
      birthdayDay: true,
      anniversary: true,
      socialLinks: true,
      firstMetDate: true,
      firstMetContext: true,
    } as const;
    const [contacts, total] = await Promise.all([
      this.prisma.contact.findMany({
        where,
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }, { id: "asc" }],
        skip: offset,
        take: limit,
        select,
      }),
      this.prisma.contact.count({ where }),
    ]);
    return {
      contacts: contacts.map((contact) => ({
        id: contact.id,
        name: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
        missingFields: missingFields(contact),
      })),
      total,
      offset,
      limit,
    };
  }

  async listCandidates(
    ownerId: string,
    contactId: string,
    page: EnrichmentPageInput = {}
  ) {
    const { offset, limit } = normalizePage(page);
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, ownerId, isDemo: false },
      select: { id: true },
    });
    if (!contact) throw new NotFoundException("Contact not found");
    const where = {
      ownerId,
      contactId,
      ...(page.status ? { status: page.status } : {}),
    };
    const [candidates, total] = await Promise.all([
      this.prisma.contactEnrichmentCandidate.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: limit,
      }),
      this.prisma.contactEnrichmentCandidate.count({ where }),
    ]);
    return { candidates, total, offset, limit };
  }

  async submitCandidate(
    ownerId: string,
    input: SubmitEnrichmentCandidateInput,
    client: EnrichmentClient = this.prisma
  ) {
    const contact = await client.contact.findFirst({
      where: { id: input.contactId, ownerId, isDemo: false },
      select: { id: true },
    });
    if (!contact) throw new NotFoundException("Contact not found");
    const normalized = normalizeSubmission(input);
    const contentHash = hashCanonicalJson({
      contactId: input.contactId,
      fieldName: input.fieldName,
      proposedValue: normalized.proposedValue,
      sourceKind: input.sourceKind,
      sourceLocator: normalized.sourceLocator,
      sourceReference: normalized.sourceReference ?? null,
    });
    const where = { ownerId, contactId: input.contactId, contentHash };
    const existing = await client.contactEnrichmentCandidate.findFirst({
      where,
    });
    if (existing) return { candidate: existing, deduplicated: true };

    try {
      const created = await client.contactEnrichmentCandidate.create({
        data: {
          ownerId,
          contactId: input.contactId,
          fieldName: input.fieldName,
          proposedValue: normalized.proposedValue as Prisma.InputJsonValue,
          sourceKind: input.sourceKind,
          sourceLocator: normalized.sourceLocator,
          sourceReference: normalized.sourceReference,
          sourceRetrievedAt: normalized.sourceRetrievedAt,
          confidence: input.confidence,
          matchRationale: normalized.matchRationale,
          contentHash,
          status: "pending",
        },
      });
      return { candidate: created, deduplicated: false };
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const duplicate = await client.contactEnrichmentCandidate.findFirst({
        where,
      });
      if (!duplicate) throw error;
      return { candidate: duplicate, deduplicated: true };
    }
  }

  async correctSocialLink(
    ownerId: string,
    input: CorrectSocialLinkInput,
    client?: SocialCorrectionClient
  ) {
    if (!client) {
      return this.prisma.$transaction((transaction) =>
        this.correctSocialLink(ownerId, input, transaction)
      );
    }

    const normalized = normalizeSocialCorrection(input);
    const contact = await client.contact.findFirst({
      where: { id: input.contactId, ownerId, isDemo: false },
      select: { id: true, socialLinks: true },
    });
    if (!contact) throw new NotFoundException("Contact not found");

    const currentLinks = normalizeExistingSocialLinks(contact.socialLinks);
    const previousValue = currentLinks.normalized[normalized.socialKey];
    const rawPreviousValue = currentLinks.raw[normalized.socialKey];
    if (typeof previousValue !== "string") {
      throw new ConflictException("Contact social link is not populated");
    }
    if (typeof rawPreviousValue !== "string") {
      throw new ConflictException("Contact social link is not populated");
    }
    if (
      normalized.expectedCurrentValue !== undefined &&
      normalized.expectedCurrentValue !== previousValue
    ) {
      throw new ConflictException("Contact social link has changed");
    }
    if (normalized.correctedValue === previousValue) {
      throw new ConflictException("Corrected social link matches current value");
    }

    const proposedValue = sortJsonObject({
      ...currentLinks.raw,
      [normalized.socialKey]: normalized.correctedValue,
    });
    const now = new Date();
    const previousValuePayload = { [normalized.socialKey]: rawPreviousValue };
    const contentHash = hashCanonicalJson({
      correctionKind: "social_link_replace",
      contactId: input.contactId,
      socialKey: normalized.socialKey,
      previousValue: previousValuePayload,
      proposedValue,
      sourceKind: input.sourceKind,
      sourceLocator: normalized.sourceLocator,
      sourceReference: normalized.sourceReference ?? null,
      sourceRetrievedAt: normalized.sourceRetrievedAt.toISOString(),
    });

    const candidate = await client.contactEnrichmentCandidate.create({
      data: {
        ownerId,
        contactId: input.contactId,
        fieldName: "socialLinks",
        previousValue: previousValuePayload,
        proposedValue: proposedValue as Prisma.InputJsonValue,
        correctionKind: "social_link_replace",
        sourceKind: input.sourceKind,
        sourceLocator: normalized.sourceLocator,
        sourceReference: normalized.sourceReference,
        sourceRetrievedAt: normalized.sourceRetrievedAt,
        confidence: input.confidence,
        matchRationale: normalized.matchRationale,
        contentHash,
        status: "accepted",
        decidedAt: now,
        appliedAt: now,
      },
    });

    const updated = await client.contact.updateMany({
      where: {
        id: input.contactId,
        ownerId,
        isDemo: false,
        socialLinks: { equals: currentLinks.raw as Prisma.InputJsonValue },
      },
      data: { socialLinks: proposedValue as Prisma.InputJsonValue },
    });
    if (updated.count !== 1) {
      throw new ConflictException("Contact social link has changed");
    }

    return {
      contactId: input.contactId,
      socialKey: normalized.socialKey,
      status: "accepted" as const,
      applied: true,
      correctedValue: normalized.correctedValue,
      appliedAt: now.toISOString(),
      provenance: {
        candidateId: candidate.id,
        sourceKind: candidate.sourceKind,
        sourceLocator: candidate.sourceLocator,
        sourceReference: null,
        sourceRetrievedAt: candidate.sourceRetrievedAt.toISOString(),
        confidence: candidate.confidence,
      },
    };
  }

  async acceptCandidate(
    ownerId: string,
    candidateId: string,
    client: EnrichmentClient = this.prisma
  ) {
    const candidate = await client.contactEnrichmentCandidate.findFirst({
      where: { id: candidateId, ownerId },
    });
    if (!candidate) throw new NotFoundException("Candidate not found");
    if (candidate.status === "accepted") {
      return acceptanceReceipt(candidate, false);
    }
    if (candidate.status !== "pending") {
      throw new ConflictException("Candidate is no longer pending");
    }
    if (
      candidate.sourceKind === "public_web" ||
      candidate.confidence < AUTO_ACCEPT_CONFIDENCE
    ) {
      throw new ConflictException("Candidate requires human review");
    }

    const fieldName = candidate.fieldName as EnrichmentField;
    const value = normalizeCandidateValue(fieldName, candidate.proposedValue);
    const update = contactUpdate(
      candidate.contactId,
      ownerId,
      fieldName,
      value
    );
    const contactResult = await client.contact.updateMany(update);
    if (contactResult.count !== 1) {
      throw new ConflictException("Contact field is already populated");
    }

    const now = new Date();
    const accepted = await client.contactEnrichmentCandidate.updateMany({
      where: { id: candidate.id, ownerId, status: "pending" },
      data: { status: "accepted", decidedAt: now, appliedAt: now },
    });
    if (accepted.count !== 1) {
      throw new ConflictException("Candidate is no longer pending");
    }
    await client.contactEnrichmentCandidate.updateMany({
      where: {
        ownerId,
        contactId: candidate.contactId,
        fieldName: candidate.fieldName,
        status: "pending",
        id: { not: candidate.id },
      },
      data: { status: "superseded", decidedAt: now },
    });
    return acceptanceReceipt({ ...candidate, appliedAt: now }, true);
  }
}

function normalizeSubmission(input: SubmitEnrichmentCandidateInput) {
  const sourceLocator = normalizeSourceLocator(
    input.sourceKind,
    input.sourceLocator
  );
  const sourceReference = input.sourceReference?.trim() || undefined;
  const matchRationale = input.matchRationale.trim();
  const sourceRetrievedAt = new Date(input.sourceRetrievedAt);
  if (
    !sourceLocator ||
    hasControlCharacters(sourceLocator) ||
    (sourceReference?.length ?? 0) > 500 ||
    (sourceReference !== undefined && hasControlCharacters(sourceReference)) ||
    !matchRationale ||
    matchRationale.length > 1_000 ||
    !Number.isFinite(input.confidence) ||
    input.confidence < 0 ||
    input.confidence > 1 ||
    Number.isNaN(sourceRetrievedAt.getTime())
  ) {
    throw new BadRequestException("Invalid enrichment candidate metadata");
  }
  return {
    proposedValue: normalizeCandidateValue(
      input.fieldName,
      input.proposedValue
    ),
    sourceLocator,
    sourceReference,
    matchRationale,
    sourceRetrievedAt,
  };
}

function normalizeSocialCorrection(input: CorrectSocialLinkInput) {
  if (!input.expectedCurrentValue) {
    throw new BadRequestException("Invalid social link correction intent");
  }
  if (!AUTOMATIC_CORRECTION_SOURCE_KINDS.has(input.sourceKind)) {
    throw new BadRequestException("Invalid enrichment candidate metadata");
  }
  const socialKey = normalizeSocialKey(input.socialKey);
  const expectedCurrentValue = normalizeSocialUrl(
    socialKey,
    input.expectedCurrentValue
  );
  const correctedValue = normalizeSocialUrl(socialKey, input.correctedValue);
  const sourceLocator = normalizeSourceLocator(
    input.sourceKind,
    input.sourceLocator
  );
  const sourceReference = input.sourceReference.trim();
  const matchRationale = input.matchRationale.trim();
  const sourceRetrievedAt = new Date(input.sourceRetrievedAt);
  if (
    !sourceReference ||
    sourceReference.length > 500 ||
    hasControlCharacters(sourceReference) ||
    !matchRationale ||
    matchRationale.length > 1_000 ||
    !Number.isFinite(input.confidence) ||
    input.confidence < 0 ||
    input.confidence > 1 ||
    Number.isNaN(sourceRetrievedAt.getTime())
  ) {
    throw new BadRequestException("Invalid enrichment candidate metadata");
  }
  return {
    socialKey,
    expectedCurrentValue,
    correctedValue,
    sourceLocator,
    sourceReference,
    matchRationale,
    sourceRetrievedAt,
  };
}

function normalizeSocialUrl(socialKey: string, value: string): string {
  const normalized = normalizeCandidateValue("socialLinks", {
    [socialKey]: value,
  }) as Prisma.JsonObject;
  return normalized[socialKey] as string;
}

function normalizeExistingSocialLinks(value: Prisma.JsonValue): {
  raw: Prisma.JsonObject;
  normalized: Prisma.JsonObject;
} {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new ConflictException("Contact social links are malformed");
  }
  const entries = Object.entries(value);
  if (entries.length === 0 || entries.length > 10) {
    throw new ConflictException("Contact social links are malformed");
  }
  for (const key of Object.keys(value)) {
    if (isUnsafeObjectKey(key)) {
      throw new BadRequestException("Invalid social link key");
    }
  }
  const normalized = normalizeCandidateValue(
    "socialLinks",
    value as Prisma.JsonObject
  ) as Prisma.JsonObject;
  return {
    raw: sortJsonObject(value as Prisma.JsonObject),
    normalized: sortJsonObject(normalized),
  };
}

function normalizeSocialKey(rawKey: string): string {
  if (isUnsafeObjectKey(rawKey)) {
    throw new BadRequestException("Invalid social link key");
  }
  const normalized = rawKey.trim().toLowerCase();
  const probeUrl = SOCIAL_KEY_PROBE_URLS[normalized];
  if (!probeUrl) throw new BadRequestException("Invalid social link key");
  const probe = normalizeCandidateValue("socialLinks", {
    [normalized]: probeUrl,
  });
  if (!probe) throw new BadRequestException("Invalid social link key");
  return normalized;
}

function sortJsonObject(value: Prisma.JsonObject): Prisma.JsonObject {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
  ) as Prisma.JsonObject;
}

function isUnsafeObjectKey(key: string): boolean {
  return key === "__proto__" || key === "prototype" || key === "constructor";
}

function normalizeSourceLocator(
  sourceKind: SubmitEnrichmentCandidateInput["sourceKind"],
  rawLocator: string
): string {
  const locator = rawLocator.trim();
  if (!locator || locator.length > 2_048 || hasControlCharacters(locator)) {
    throw new BadRequestException("Invalid enrichment candidate metadata");
  }
  const normalizedPath = locator.replace(/\\/g, "/");
  const sourceName = normalizedPath.split("/").pop()?.toLowerCase();
  if (sourceKind === "second_brain" && !/\.md$/i.test(normalizedPath)) {
    throw new BadRequestException("Invalid enrichment candidate metadata");
  }
  if (sourceKind === "vcard" && !/\.vcf$/i.test(normalizedPath)) {
    throw new BadRequestException("Invalid enrichment candidate metadata");
  }
  if (sourceKind === "arc_history" && !/\/History$/i.test(normalizedPath)) {
    throw new BadRequestException("Invalid enrichment candidate metadata");
  }
  if (
    sourceKind === "arc_sidebar" &&
    sourceName !== "storablesidebar.json" &&
    sourceName !== "storablearchiveitems.json"
  ) {
    throw new BadRequestException("Invalid enrichment candidate metadata");
  }
  if (sourceKind === "public_web") {
    try {
      const normalized = normalizeCandidateValue("photo", locator) as string;
      if (
        /(?:^|\.)(?:spokeo|whitepages|beenverified|peoplefinder|truthfinder|radaris)\.com$/i.test(
          new URL(normalized).hostname
        )
      ) {
        throw new Error("Data broker source");
      }
      return normalized;
    } catch {
      throw new BadRequestException("Invalid enrichment candidate metadata");
    }
  }
  return locator;
}

function contactUpdate(
  contactId: string,
  ownerId: string,
  fieldName: EnrichmentField,
  value: Prisma.JsonValue
): Prisma.ContactUpdateManyArgs {
  const base = { id: contactId, ownerId, isDemo: false };
  if (fieldName === "birthday") {
    if (typeof value === "string") {
      const [, month, day] = value.split("-").map(Number);
      return {
        where: {
          ...base,
          birthday: null,
          birthdayMonth: null,
          birthdayDay: null,
        },
        data: {
          birthday: new Date(`${value}T00:00:00.000Z`),
          birthdayMonth: month,
          birthdayDay: day,
        },
      };
    }
    const parts = value as Prisma.JsonObject;
    return {
      where: {
        ...base,
        birthday: null,
        birthdayMonth: null,
        birthdayDay: null,
      },
      data: {
        birthdayMonth: parts.month as number,
        birthdayDay: parts.day as number,
      },
    };
  }
  if (fieldName === "anniversary" || fieldName === "firstMetDate") {
    return {
      where: { ...base, [fieldName]: null },
      data: { [fieldName]: new Date(`${value as string}T00:00:00.000Z`) },
    };
  }
  if (fieldName === "socialLinks") {
    return {
      where: {
        ...base,
        OR: [
          { socialLinks: { equals: Prisma.DbNull } },
          { socialLinks: { equals: {} } },
        ],
      },
      data: { socialLinks: value as Prisma.InputJsonValue },
    };
  }
  return {
    where: { ...base, OR: [{ [fieldName]: null }, { [fieldName]: "" }] },
    data: { [fieldName]: value as string },
  };
}

function missingFields(contact: Record<string, unknown>): EnrichmentField[] {
  const missing: EnrichmentField[] = [];
  for (const fieldName of ["photo", "bio", "company", "jobTitle"] as const) {
    if (typeof contact[fieldName] !== "string" || !contact[fieldName]) {
      missing.push(fieldName);
    }
  }
  if (!contact.birthday && !(contact.birthdayMonth && contact.birthdayDay)) {
    missing.push("birthday");
  }
  if (!contact.anniversary) missing.push("anniversary");
  if (
    !contact.socialLinks ||
    (typeof contact.socialLinks === "object" &&
      Object.keys(contact.socialLinks as object).length === 0)
  ) {
    missing.push("socialLinks");
  }
  if (!contact.firstMetDate) missing.push("firstMetDate");
  if (!contact.firstMetContext) missing.push("firstMetContext");
  return missing;
}

function normalizePage(page: EnrichmentPageInput) {
  const offset = Math.max(0, page.offset ?? 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, page.limit ?? DEFAULT_LIMIT));
  return { offset, limit };
}

function acceptanceReceipt(
  candidate: {
    id: string;
    contactId: string;
    fieldName: string;
    appliedAt: Date | null;
  },
  applied: boolean
) {
  return {
    candidateId: candidate.id,
    contactId: candidate.contactId,
    fieldName: candidate.fieldName,
    status: "accepted" as const,
    applied,
    appliedAt: candidate.appliedAt?.toISOString?.() ?? null,
  };
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function isUniqueConflict(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    (error as { code?: unknown }).code === "P2002"
  );
}
