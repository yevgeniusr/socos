export type RelationshipHealthBand =
  | "excellent"
  | "healthy"
  | "needs-attention"
  | "at-risk";

export interface RelationshipHealthInput {
  now: Date;
  lastContactedAt: Date | null;
  preferredCadenceDays: number;
}

export interface RelationshipHealth {
  score: number;
  band: RelationshipHealthBand;
  daysSinceContact: number | null;
  daysOverdue: number;
  reasonCode: string;
}

export interface RelationshipRankInput {
  healthScore: number;
  importance: number;
  daysUntilImportantDate?: number | null;
  pendingTaskCount?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function healthBand(score: number): RelationshipHealthBand {
  if (score >= 80) return "excellent";
  if (score >= 60) return "healthy";
  if (score >= 30) return "needs-attention";
  return "at-risk";
}

export function assessRelationship(
  input: RelationshipHealthInput
): RelationshipHealth {
  if (
    !Number.isInteger(input.preferredCadenceDays) ||
    input.preferredCadenceDays <= 0
  ) {
    throw new Error("preferredCadenceDays must be a positive integer");
  }

  if (!input.lastContactedAt) {
    return {
      score: 35,
      band: "needs-attention",
      daysSinceContact: null,
      daysOverdue: 0,
      reasonCode: "never_contacted",
    };
  }

  const daysSinceContact = Math.max(
    0,
    Math.floor((input.now.getTime() - input.lastContactedAt.getTime()) / DAY_MS)
  );
  const daysOverdue = Math.max(
    0,
    daysSinceContact - input.preferredCadenceDays
  );
  const score = Math.round(
    clamp(100 - (daysSinceContact / input.preferredCadenceDays) * 50, 0, 100)
  );

  return {
    score,
    band: healthBand(score),
    daysSinceContact,
    daysOverdue,
    reasonCode:
      daysOverdue > 0
        ? "cadence_overdue"
        : daysSinceContact === input.preferredCadenceDays
          ? "cadence_due"
          : "cadence_healthy",
  };
}

export function rankRelationship(input: RelationshipRankInput): number {
  const daysUntilImportantDate = input.daysUntilImportantDate;
  const dateBoost =
    daysUntilImportantDate != null && daysUntilImportantDate >= 0
      ? daysUntilImportantDate <= 7
        ? 20
        : daysUntilImportantDate <= 14
          ? 10
          : 0
      : 0;
  const commitmentBoost = (input.pendingTaskCount ?? 0) > 0 ? 15 : 0;
  const urgency =
    (100 - input.healthScore) * 0.5 +
    input.importance * 8 +
    dateBoost +
    commitmentBoost;

  return Math.round(clamp(urgency, 0, 100));
}
