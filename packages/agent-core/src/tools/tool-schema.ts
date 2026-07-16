/**
 * SOCOS AI Agent Tool Schema
 *
 * Defines the interface contracts for all tools the AI agent can call.
 * These types are shared between the API (NestJS) and any external agent consumers.
 */

// ========== Tool 1: suggestContacts ==========

export interface SuggestContactsInput {
  /** Filter by reason: stale | birthday | followup | new */
  reason?: 'stale' | 'birthday' | 'followup' | 'new';
  /** Max number of contacts to return (default: 5) */
  limit?: number;
}

export interface SuggestedContact {
  id: string;
  name: string;
  lastContactedAt: string | null; // ISO date string
  reason: string;
  priority: 'high' | 'medium' | 'low';
  upcomingBirthday: boolean;
  relationshipScore: number;
  daysSinceContact: number | null;
}

export interface SuggestContactsOutput {
  contacts: SuggestedContact[];
}

// ========== Tool 2: scheduleReminder ==========

export interface ScheduleReminderInput {
  /** Contact ID to schedule reminder for */
  contactId: string;
  /** Reminder type */
  type: 'birthday' | 'followup' | 'custom';
  /** ISO 8601 date string for when to fire the reminder */
  scheduledAt: string;
  /** Optional custom message */
  message?: string;
}

export interface ScheduleReminderOutput {
  /** Created reminder ID */
  reminderId: string;
  /** Whether creation succeeded */
  success: boolean;
}

// ========== Tool 3: generateNotes ==========

export interface RecentInteraction {
  type: string;
  content: string;
  date: string; // ISO date string
}

export interface GenerateNotesInput {
  /** Contact ID to generate notes for */
  contactId: string;
  /** Optional recent interactions to include in summary */
  recentInteractions?: RecentInteraction[];
}

export interface GenerateNotesOutput {
  /** AI-generated summary text */
  summary: string;
  /** Suggested tags for the contact/interaction */
  suggestedTags: string[];
}

// ========== Tool 4: assessRelationshipHealth ==========

export interface RelationshipStats {
  daysSinceContact: number | null;
  interactionCount90d: number;
  lastInteractionType: string | null;
}

export interface RelationshipAssessment {
  contactId: string;
  contactName: string;
  healthScore: number; // 0-100
  healthBand: 'excellent' | 'healthy' | 'needs-attention' | 'at-risk';
  insight: string;
  recommendation: string;
  stats: RelationshipStats;
}

export interface AssessRelationshipHealthInput {
  contactId: string;
}

export interface AssessRelationshipHealthOutput {
  assessment: RelationshipAssessment;
}

// ========== Hermes Daily Social Brief REST v1 ==========

export type BriefItemState = 'pending' | 'accepted' | 'snoozed' | 'dismissed';

export interface DailyBriefV1 {
  schemaVersion: '1.0';
  briefId: string;
  localDate: string;
  timeZone: string;
  generatedAt: string;
  people: Array<{
    itemId: string;
    rank: number;
    contact: { id: string; name: string };
    health: {
      score: number;
      band: 'excellent' | 'healthy' | 'needs-attention' | 'at-risk';
    };
    lastInteractionAt: string | null;
    reason: string;
    evidence: Array<{ code: string; value: string | number | null }>;
    state: BriefItemState;
  }>;
  dates: Array<{
    itemId: string;
    rank: number;
    contact: { id: string; name: string };
    type: 'birthday' | 'anniversary' | 'celebration' | 'reminder';
    title: string;
    date: string;
    daysAway: number;
    reason: string;
    state: BriefItemState;
  }>;
  quests: Array<{
    questId: string;
    itemId: string;
    title: string;
    completionType: 'interaction' | 'reminder';
    xpReward: number;
    status: 'pending' | 'completed';
  }>;
  allowedActions: ['accept', 'snooze', 'dismiss', 'complete'];
}

export type BriefItemFeedbackInput =
  | { action: 'accept' }
  | { action: 'snooze'; snoozedUntil: string }
  | { action: 'dismiss'; reason?: string };

export type QuestCompletionInput =
  | { interactionId: string; reminderId?: never }
  | { reminderId: string; interactionId?: never };

// ========== Union type for all tools ==========

export type AgentToolName =
  | 'suggestContacts'
  | 'scheduleReminder'
  | 'generateNotes'
  | 'assessRelationshipHealth';

export type AgentToolInput =
  | SuggestContactsInput
  | ScheduleReminderInput
  | GenerateNotesInput
  | AssessRelationshipHealthInput;

export type AgentToolOutput =
  | SuggestContactsOutput
  | ScheduleReminderOutput
  | GenerateNotesOutput
  | AssessRelationshipHealthOutput;
