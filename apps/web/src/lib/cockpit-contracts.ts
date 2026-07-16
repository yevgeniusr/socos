import type { DailyBrief } from "@socos/agent-core";

export type { DailyBrief };

export type ProposalHistoryStatus =
  | "all"
  | "pending"
  | "approved"
  | "rejected"
  | "expired";

type ContactReference = { id: string; name: string };

export type ProposalPreview =
  | { type: "message"; contact: ContactReference; channel: string; body: string }
  | {
      type: "introduction";
      contact: ContactReference;
      otherContact: ContactReference;
      context: string | null;
    }
  | {
      type: "invitation";
      contact: ContactReference;
      title: string;
      scheduledAt: string | null;
    }
  | {
      type: "merge";
      sourceContact: ContactReference;
      targetContact: ContactReference;
    }
  | {
      type: "delete";
      entityType: "contact" | "interaction" | "reminder";
      entityId: string;
      label: string;
    }
  | { type: "unavailable"; label: "Unavailable preview" };

export interface ProposalHistoryResponse {
  proposals: Array<{
    id: string;
    actionType: "message" | "introduction" | "invitation" | "merge" | "delete" | "unavailable";
    preview: ProposalPreview;
    status: Exclude<ProposalHistoryStatus, "all"> | "unavailable";
    expiresAt: string;
    decidedAt: string | null;
    createdAt: string;
    client: { id: string; name: string };
    grant: null | {
      status: string;
      expiresAt: string;
      consumedAt: string | null;
      revokedAt: string | null;
      outbox: null | {
        status: string;
        attempts: number;
        completedAt: string | null;
        lastErrorCode: string | null;
      };
    };
  }>;
  total: number;
  offset: number;
  limit: number;
}

export type QuestAction =
  | { questId: string; completionType: "interaction"; contact: ContactReference }
  | {
      questId: string;
      completionType: "reminder";
      contact: ContactReference;
      reminder: {
        id: string;
        title: string;
        scheduledAt: string;
        status: "pending" | "completed";
      };
    };

export interface UpcomingRemindersResponse {
  reminders: Array<{
    id: string;
    title: string;
    type: string;
    scheduledAt: string;
    status: string;
    contact: {
      id: string;
      firstName: string;
      lastName: string | null;
      photo: string | null;
    };
  }>;
  stats: { today: number; thisWeek: number; overdue: number };
}

export interface GamificationStatsResponse {
  user: { id: string; name: string; email: string; xp: number; level: number } | null;
  stats: {
    totalContacts: number;
    totalInteractions: number;
    xpProgress: number;
    xpNeeded: number;
    levelName: string;
  } | null;
}

export interface StreakResponse {
  streakDays: number;
  lastActiveAt: string | null;
  checkedInToday: boolean;
  checkedInYesterday: boolean;
  streakAtRisk: boolean;
}
