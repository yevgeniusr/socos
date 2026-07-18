import type { Prisma } from "@prisma/client";

export const ENRICHMENT_FIELDS = [
  "photo",
  "bio",
  "company",
  "jobTitle",
  "birthday",
  "anniversary",
  "socialLinks",
  "firstMetDate",
  "firstMetContext",
] as const;

export type EnrichmentField = (typeof ENRICHMENT_FIELDS)[number];

export const ENRICHMENT_SOURCE_KINDS = [
  "second_brain",
  "arc_history",
  "arc_sidebar",
  "vcard",
  "public_web",
] as const;

export type EnrichmentSourceKind = (typeof ENRICHMENT_SOURCE_KINDS)[number];

export const ENRICHMENT_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "superseded",
] as const;

export type EnrichmentStatus = (typeof ENRICHMENT_STATUSES)[number];

export interface SubmitEnrichmentCandidateInput {
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

export interface EnrichmentPageInput {
  offset?: number;
  limit?: number;
  status?: EnrichmentStatus;
}
