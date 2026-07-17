export type ContactFieldWriteType =
  | "email"
  | "phone"
  | "address"
  | "website"
  | "other";
export type InteractionType =
  | "call"
  | "message"
  | "meeting"
  | "note"
  | "email"
  | "social";
export type ReminderType = "birthday" | "followup" | "anniversary" | "custom";

export interface ContactField {
  id: string;
  type: string;
  value: string;
  label: string | null;
  isPrimary: boolean;
}

export interface ContactFieldInput {
  type: ContactFieldWriteType;
  value: string;
  label?: string;
  isPrimary?: boolean;
}

export interface ContactCounts {
  interactions: number;
  reminders: number;
}

export interface ContactListItem {
  id: string;
  firstName: string;
  lastName: string | null;
  nickname: string | null;
  photo: string | null;
  company: string | null;
  jobTitle: string | null;
  relationshipScore: number;
  importance: number;
  preferredCadenceDays: number;
  labels: string[];
  tags: string[];
  groups: string[];
  lastContactedAt: string | null;
  nextReminderAt: string | null;
  createdAt: string;
  updatedAt: string;
  _count: ContactCounts;
}

export interface ContactInteraction {
  id: string;
  type: string;
  title: string | null;
  content: string | null;
  occurredAt: string;
}

export interface ContactReminder {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: string;
}

export type SocialLinks = Partial<
  Record<
    "linkedin" | "twitter" | "instagram" | "facebook" | "github" | "website",
    string
  >
>;

export interface ContactDetail extends Omit<ContactListItem, "_count"> {
  middleName: string | null;
  bio: string | null;
  birthday: string | null;
  anniversary: string | null;
  socialLinks: SocialLinks | null;
  firstMetDate: string | null;
  firstMetContext: string | null;
  sourceSystem: string | null;
  importedAt: string | null;
  contactFields: ContactField[];
  interactions: ContactInteraction[];
  reminders: ContactReminder[];
  _count: ContactCounts & { tasks: number; gifts: number };
}

export interface ContactListResponse {
  contacts: ContactListItem[];
  total: number;
  offset: number;
  limit: number;
}

interface ContactWriteFields {
  firstName?: string;
  lastName?: string;
  nickname?: string;
  photo?: string;
  bio?: string;
  company?: string;
  jobTitle?: string;
  labels?: string[];
  tags?: string[];
  groups?: string[];
  socialLinks?: SocialLinks;
  firstMetContext?: string | null;
  importance?: number;
  preferredCadenceDays?: number;
  contactFields?: ContactFieldInput[];
}

export interface CreateContactPayload extends ContactWriteFields {
  firstName: string;
  birthday?: string;
  anniversary?: string;
  firstMetDate?: string;
}

export interface UpdateContactPayload extends ContactWriteFields {
  birthday?: string | null;
  anniversary?: string | null;
  firstMetDate?: string | null;
}

export interface CreateInteractionPayload {
  contactId: string;
  type: InteractionType;
  title: string;
  content: string;
  occurredAt: string;
}

export interface InteractionReceiptEnvelope {
  interaction: {
    id: string;
    contactId: string;
    type: string;
    title: string | null;
    content: string | null;
    summary: string | null;
    occurredAt: string;
    duration: number | null;
    location: string | null;
    xpEarned: number;
    createdAt: string;
  };
  lastContact: {
    previousAt: string | null;
    resultingAt: string | null;
    advanced: boolean;
  };
  xp: {
    interactionDelta: number;
    achievementDelta: number;
    totalDelta: number;
    totalAfter: number;
    levelAfter: number;
  };
  outcome: "Recorded only; nothing sent";
  createdAt: string;
}

export interface CreateReminderPayload {
  contactId: string;
  type: ReminderType;
  title: string;
  description: string;
  scheduledAt: string;
}
