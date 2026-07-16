import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  BriefItemFeedbackAction,
  BriefItemFeedbackDto,
  QuestCompletionDto,
} from "./briefs.dto.js";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

type ValidatedItemFeedback =
  | { action: "accept"; reason: null; snoozedUntil: null }
  | { action: "snooze"; reason: null; snoozedUntil: Date }
  | { action: "dismiss"; reason: string | null; snoozedUntil: null };

type ValidatedQuestCompletion =
  | { interactionId: string; reminderId: null }
  | { interactionId: null; reminderId: string };

export interface BriefFeedbackResult {
  feedbackId: string;
  itemId: string;
  action: BriefItemFeedbackAction;
  status: "accepted" | "snoozed" | "dismissed";
  reason: string | null;
  snoozedUntil: Date | null;
}

export interface QuestCompletionResult {
  feedbackId: string;
  questId: string;
  status: "completed";
  completedAt: Date;
  xpAwarded: number;
}

export type QuestAction =
  | {
      questId: string;
      completionType: "interaction";
      contact: { id: string; name: string };
    }
  | {
      questId: string;
      completionType: "reminder";
      contact: { id: string; name: string };
      reminder: {
        id: string;
        title: string;
        scheduledAt: Date;
        status: "pending" | "completed";
      };
    };

type FeedbackRecord = {
  id: string;
  briefItemId: string | null;
  questId: string | null;
  action: string;
  reason: string | null;
  snoozedUntil: Date | null;
  requestHash: string;
};

@Injectable()
export class BriefFeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async getQuestAction(ownerId: string, questId: string): Promise<QuestAction> {
    const quest = await this.prisma.quest.findFirst({
      where: { id: questId, ownerId },
      select: {
        id: true,
        completionType: true,
        targetId: true,
        briefItem: { select: { contactId: true } },
      },
    });
    const contactId = quest?.briefItem.contactId;
    if (
      !quest ||
      !contactId ||
      (quest.completionType !== "interaction" &&
        quest.completionType !== "reminder") ||
      (quest.completionType === "interaction" && quest.targetId !== contactId)
    ) {
      throw questActionNotFound();
    }

    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, ownerId, isDemo: false },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!contact) throw questActionNotFound();

    const targetContact = {
      id: contact.id,
      name: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
    };
    if (quest.completionType === "interaction") {
      return {
        questId: quest.id,
        completionType: "interaction",
        contact: targetContact,
      };
    }

    const reminder = await this.prisma.reminder.findFirst({
      where: {
        id: quest.targetId,
        ownerId,
        contactId,
        contact: { ownerId, isDemo: false },
      },
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        status: true,
      },
    });
    if (
      !reminder ||
      (reminder.status !== "pending" && reminder.status !== "completed")
    ) {
      throw questActionNotFound();
    }

    return {
      questId: quest.id,
      completionType: "reminder",
      contact: targetContact,
      reminder: {
        id: reminder.id,
        title: reminder.title,
        scheduledAt: reminder.scheduledAt,
        status: reminder.status,
      },
    };
  }

  async recordItemFeedback(
    ownerId: string,
    itemId: string,
    idempotencyKey: string,
    dto: BriefItemFeedbackDto
  ): Promise<BriefFeedbackResult> {
    this.assertIdempotencyKey(idempotencyKey);
    const request = this.validateItemFeedback(dto);
    const requestHash = hashCanonical({
      operation: "item-feedback",
      itemId,
      action: request.action,
      reason: request.reason,
      snoozedUntil: request.snoozedUntil?.toISOString() ?? null,
    });

    try {
      return await this.prisma.$transaction(
        (tx) =>
          this.recordItemFeedbackInTransaction(
            tx,
            ownerId,
            itemId,
            idempotencyKey,
            request,
            requestHash
          ),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (!isPersistenceRace(error)) {
        throw error;
      }
      const existing = await this.prisma.briefFeedback.findUnique({
        where: { ownerId_idempotencyKey: { ownerId, idempotencyKey } },
      });
      if (!existing) {
        throw error;
      }
      return this.resolveItemRaceReplay(ownerId, itemId, requestHash, existing);
    }
  }

  async recordItemFeedbackForAgent(
    ownerId: string,
    itemId: string,
    idempotencyKey: string,
    dto: BriefItemFeedbackDto,
    tx: Prisma.TransactionClient
  ): Promise<BriefFeedbackResult> {
    this.assertIdempotencyKey(idempotencyKey);
    const request = this.validateItemFeedback(dto);
    const requestHash = hashCanonical({
      operation: "item-feedback",
      itemId,
      action: request.action,
      reason: request.reason,
      snoozedUntil: request.snoozedUntil?.toISOString() ?? null,
    });
    return this.recordItemFeedbackInTransaction(
      tx,
      ownerId,
      itemId,
      idempotencyKey,
      request,
      requestHash
    );
  }

  async completeQuest(
    ownerId: string,
    questId: string,
    idempotencyKey: string,
    dto: QuestCompletionDto
  ): Promise<QuestCompletionResult> {
    this.assertIdempotencyKey(idempotencyKey);
    const evidence = this.validateQuestCompletion(dto);
    const requestHash = hashCanonical({
      operation: "quest-completion",
      questId,
      interactionId: evidence.interactionId,
      reminderId: evidence.reminderId,
    });

    try {
      return await this.prisma.$transaction(
        (tx) =>
          this.completeQuestInTransaction(
            tx,
            ownerId,
            questId,
            idempotencyKey,
            evidence,
            requestHash
          ),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (error) {
      if (!isCompletionRace(error)) {
        throw error;
      }
      return this.resolveCompletionRace(
        ownerId,
        questId,
        idempotencyKey,
        requestHash,
        error
      );
    }
  }

  async completeQuestForAgent(
    ownerId: string,
    questId: string,
    idempotencyKey: string,
    dto: QuestCompletionDto,
    tx: Prisma.TransactionClient
  ): Promise<QuestCompletionResult> {
    this.assertIdempotencyKey(idempotencyKey);
    const evidence = this.validateQuestCompletion(dto);
    const requestHash = hashCanonical({
      operation: "quest-completion",
      questId,
      interactionId: evidence.interactionId,
      reminderId: evidence.reminderId,
    });
    return this.completeQuestInTransaction(
      tx,
      ownerId,
      questId,
      idempotencyKey,
      evidence,
      requestHash
    );
  }

  private async recordItemFeedbackInTransaction(
    tx: Prisma.TransactionClient,
    ownerId: string,
    itemId: string,
    idempotencyKey: string,
    request: ValidatedItemFeedback,
    requestHash: string
  ): Promise<BriefFeedbackResult> {
    const existing = await tx.briefFeedback.findUnique({
      where: { ownerId_idempotencyKey: { ownerId, idempotencyKey } },
    });
    if (existing) {
      const replay = this.resolveItemReplay(existing, itemId, requestHash);
      const replayedItem = await tx.briefItem.findFirst({
        where: { id: itemId, ownerId },
      });
      if (!replayedItem) throw new NotFoundException("Brief item not found");
      await this.assertBriefItemResource(tx, ownerId, replayedItem);
      return replay;
    }

    const item = await tx.briefItem.findFirst({ where: { id: itemId, ownerId } });
    if (!item) throw new NotFoundException("Brief item not found");
    await this.assertBriefItemResource(tx, ownerId, item);
    if (
      request.action === "accept" &&
      item.status !== "pending" &&
      item.status !== "snoozed"
    ) {
      throw new ConflictException("Brief item cannot be accepted");
    }

    const status = actionStatus(request.action);
    const actionedAt = new Date();
    await tx.briefItem.update({
      where: { id_ownerId: { id: itemId, ownerId } },
      data: { status, actionedAt, snoozedUntil: request.snoozedUntil },
    });
    const feedback = await tx.briefFeedback.create({
      data: {
        ownerId,
        briefItemId: itemId,
        action: request.action,
        reason: request.reason,
        snoozedUntil: request.snoozedUntil,
        idempotencyKey,
        requestHash,
      },
    });
    return itemResult(feedback, status);
  }

  private async completeQuestInTransaction(
    tx: Prisma.TransactionClient,
    ownerId: string,
    questId: string,
    idempotencyKey: string,
    evidence: ValidatedQuestCompletion,
    requestHash: string
  ): Promise<QuestCompletionResult> {
    const quest = await tx.quest.findFirst({
      where: { id: questId, ownerId },
      include: { briefItem: { select: { contactId: true } } },
    });
    if (!quest) throw new NotFoundException("Quest not found");
    await this.assertNonDemoContact(tx, ownerId, quest.briefItem.contactId);

    const existing = await tx.briefFeedback.findUnique({
      where: { ownerId_idempotencyKey: { ownerId, idempotencyKey } },
    });
    if (existing) {
      return this.resolveQuestReplay(tx, ownerId, questId, requestHash, existing);
    }

    if (quest.status !== "pending") throw questAlreadyCompleted();
    await this.verifyQuestEvidence(tx, ownerId, quest, evidence);

    const completedAt = new Date();
    const claim = await tx.quest.updateMany({
      where: { id: questId, ownerId, status: "pending" },
      data: { status: "completed", completedAt },
    });
    if (claim.count !== 1) throw new QuestClaimLostError();

    await tx.xpTransaction.create({
      data: {
        ownerId,
        amount: quest.xpReward,
        sourceType: "quest",
        sourceId: quest.id,
      },
    });
    await tx.user.update({
      where: { id: ownerId },
      data: { xp: { increment: quest.xpReward }, lastActiveAt: completedAt },
    });
    const feedback = await tx.briefFeedback.create({
      data: {
        ownerId,
        questId,
        action: "complete",
        idempotencyKey,
        requestHash,
      },
    });
    return {
      feedbackId: feedback.id,
      questId,
      status: "completed",
      completedAt,
      xpAwarded: quest.xpReward,
    };
  }

  private assertIdempotencyKey(idempotencyKey: string): void {
    if (
      typeof idempotencyKey !== "string" ||
      !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)
    ) {
      throw new BadRequestException("Invalid Idempotency-Key");
    }
  }

  private validateItemFeedback(
    dto: BriefItemFeedbackDto
  ): ValidatedItemFeedback {
    if (!isPlainObject(dto) || typeof dto.action !== "string") {
      throw new BadRequestException("Invalid feedback action");
    }

    if (dto.action === "accept") {
      assertExactKeys(dto, ["action"]);
      return { action: "accept", reason: null, snoozedUntil: null };
    }

    if (dto.action === "snooze") {
      assertExactKeys(dto, ["action", "snoozedUntil"]);
      if (
        typeof dto.snoozedUntil !== "string" ||
        !ISO_TIMESTAMP_PATTERN.test(dto.snoozedUntil)
      ) {
        throw new BadRequestException("A valid snooze timestamp is required");
      }
      const snoozedUntil = new Date(dto.snoozedUntil);
      const currentTime = Date.now();
      if (
        Number.isNaN(snoozedUntil.getTime()) ||
        snoozedUntil.getTime() <= currentTime ||
        snoozedUntil.getTime() > currentTime + NINETY_DAYS_MS
      ) {
        throw new BadRequestException(
          "Snooze timestamp must be within the next 90 days"
        );
      }
      return { action: "snooze", reason: null, snoozedUntil };
    }

    if (dto.action === "dismiss") {
      assertExactKeys(dto, ["action", "reason"], ["reason"]);
      if (
        dto.reason !== undefined &&
        (typeof dto.reason !== "string" || dto.reason.length > 500)
      ) {
        throw new BadRequestException(
          "Dismissal reason must be at most 500 characters"
        );
      }
      return {
        action: "dismiss",
        reason: dto.reason ?? null,
        snoozedUntil: null,
      };
    }

    throw new BadRequestException("Invalid feedback action");
  }

  private validateQuestCompletion(
    dto: QuestCompletionDto
  ): ValidatedQuestCompletion {
    if (!isPlainObject(dto)) {
      throw new BadRequestException("Completion evidence is required");
    }
    const keys = Object.keys(dto);
    if (keys.length !== 1) {
      throw new BadRequestException(
        "Provide exactly one completion evidence field"
      );
    }
    if (
      keys[0] === "interactionId" &&
      typeof dto.interactionId === "string" &&
      dto.interactionId.length > 0
    ) {
      return { interactionId: dto.interactionId, reminderId: null };
    }
    if (
      keys[0] === "reminderId" &&
      typeof dto.reminderId === "string" &&
      dto.reminderId.length > 0
    ) {
      return { interactionId: null, reminderId: dto.reminderId };
    }
    throw new BadRequestException("Invalid completion evidence");
  }

  private async verifyQuestEvidence(
    tx: Prisma.TransactionClient,
    ownerId: string,
    quest: {
      completionType: string;
      targetId: string;
      createdAt: Date;
    },
    evidence: ValidatedQuestCompletion
  ): Promise<void> {
    if (quest.completionType === "interaction") {
      if (!evidence.interactionId) {
        throw new BadRequestException("Interaction evidence is required");
      }
      const interaction = await tx.interaction.findFirst({
        where: {
          id: evidence.interactionId,
          ownerId,
          contactId: quest.targetId,
          occurredAt: { gte: quest.createdAt },
          contact: { ownerId, isDemo: false },
        },
      });
      if (!interaction) {
        throw new BadRequestException(
          "Interaction does not complete this quest"
        );
      }
      return;
    }

    if (quest.completionType === "reminder") {
      if (!evidence.reminderId || evidence.reminderId !== quest.targetId) {
        throw new BadRequestException("Target reminder evidence is required");
      }
      const reminder = await tx.reminder.findFirst({
        where: {
          id: quest.targetId,
          ownerId,
          status: "completed",
          completedAt: { gte: quest.createdAt },
          contact: { ownerId, isDemo: false },
        },
      });
      if (!reminder) {
        throw new BadRequestException("Reminder does not complete this quest");
      }
      return;
    }

    throw new ConflictException("Stored quest completion type is invalid");
  }

  private async assertBriefItemResource(
    tx: Pick<Prisma.TransactionClient, "contact" | "discoveredEvent">,
    ownerId: string,
    item: {
      contactId: string | null;
      kind: string;
      sourceType: string;
      sourceId: string | null;
    }
  ): Promise<void> {
    if (!item.contactId) {
      if (
        item.kind !== "event" ||
        item.sourceType !== "discovered_event" ||
        !item.sourceId
      ) {
        throw new NotFoundException("Brief resource not found");
      }
      const count = await tx.discoveredEvent.count({
        where: { id: item.sourceId, ownerId },
      });
      if (count !== 1) throw new NotFoundException("Brief resource not found");
      return;
    }
    const count = await tx.contact.count({
      where: { id: item.contactId, ownerId, isDemo: false },
    });
    if (count !== 1) throw new NotFoundException("Brief resource not found");
  }

  private async assertNonDemoContact(
    tx: Pick<Prisma.TransactionClient, "contact">,
    ownerId: string,
    contactId: string | null
  ): Promise<void> {
    if (!contactId) throw new NotFoundException("Brief resource not found");
    const count = await tx.contact.count({
      where: { id: contactId, ownerId, isDemo: false },
    });
    if (count !== 1) throw new NotFoundException("Brief resource not found");
  }

  private async resolveQuestReplay(
    client: Pick<Prisma.TransactionClient, "quest" | "xpTransaction">,
    ownerId: string,
    questId: string,
    requestHash: string,
    existing: FeedbackRecord
  ): Promise<QuestCompletionResult> {
    if (
      existing.questId !== questId ||
      existing.briefItemId !== null ||
      existing.action !== "complete" ||
      existing.requestHash !== requestHash
    ) {
      throw idempotencyConflict();
    }
    const [quest, ledger] = await Promise.all([
      client.quest.findFirst({ where: { id: questId, ownerId } }),
      client.xpTransaction.findUnique({
        where: {
          ownerId_sourceType_sourceId: {
            ownerId,
            sourceType: "quest",
            sourceId: questId,
          },
        },
      }),
    ]);
    if (
      !quest ||
      quest.status !== "completed" ||
      !quest.completedAt ||
      !ledger
    ) {
      throw new ConflictException("Quest completion is not durable");
    }
    return {
      feedbackId: existing.id,
      questId,
      status: "completed",
      completedAt: quest.completedAt,
      xpAwarded: ledger.amount,
    };
  }

  private async resolveCompletionRace(
    ownerId: string,
    questId: string,
    idempotencyKey: string,
    requestHash: string,
    originalError: unknown
  ): Promise<QuestCompletionResult> {
    const existing = await this.prisma.briefFeedback.findUnique({
      where: { ownerId_idempotencyKey: { ownerId, idempotencyKey } },
    });
    if (existing) {
      return this.resolveQuestReplay(
        this.prisma,
        ownerId,
        questId,
        requestHash,
        existing
      );
    }
    const quest = await this.prisma.quest.findFirst({
      where: { id: questId, ownerId },
    });
    if (quest?.status === "completed") {
      throw questAlreadyCompleted();
    }
    throw originalError;
  }

  private resolveItemReplay(
    existing: FeedbackRecord,
    itemId: string,
    requestHash: string
  ): BriefFeedbackResult {
    if (
      existing.briefItemId !== itemId ||
      existing.questId !== null ||
      existing.requestHash !== requestHash
    ) {
      throw idempotencyConflict();
    }
    const status = actionStatus(existing.action as BriefItemFeedbackAction);
    return itemResult(existing, status);
  }

  private async resolveItemRaceReplay(
    ownerId: string,
    itemId: string,
    requestHash: string,
    existing: FeedbackRecord
  ): Promise<BriefFeedbackResult> {
    const replay = this.resolveItemReplay(existing, itemId, requestHash);
    const replayedItem = await this.prisma.briefItem.findFirst({
      where: { id: itemId, ownerId },
    });
    if (!replayedItem) throw new NotFoundException("Brief item not found");
    await this.assertBriefItemResource(this.prisma, ownerId, replayedItem);
    return replay;
  }
}

function assertExactKeys(
  value: object,
  allowed: string[],
  optional: string[] = []
): void {
  const keys = Object.keys(value);
  if (
    keys.some((key) => !allowed.includes(key)) ||
    allowed.some((key) => !optional.includes(key) && !keys.includes(key))
  ) {
    throw new BadRequestException("Invalid fields for feedback action");
  }
}

function actionStatus(
  action: BriefItemFeedbackAction
): BriefFeedbackResult["status"] {
  if (action === "accept") return "accepted";
  if (action === "snooze") return "snoozed";
  if (action === "dismiss") return "dismissed";
  throw new ConflictException("Stored feedback action is invalid");
}

function itemResult(
  feedback: FeedbackRecord,
  status: BriefFeedbackResult["status"]
): BriefFeedbackResult {
  return {
    feedbackId: feedback.id,
    itemId: feedback.briefItemId as string,
    action: feedback.action as BriefItemFeedbackAction,
    status,
    reason: feedback.reason,
    snoozedUntil: feedback.snoozedUntil,
  };
}

function hashCanonical(value: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(sortObject(value)))
    .digest("hex");
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortObject(entry)])
  );
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPersistenceRace(error: unknown): boolean {
  return (
    isPlainObject(error) && (error.code === "P2002" || error.code === "P2034")
  );
}

function isCompletionRace(error: unknown): boolean {
  return error instanceof QuestClaimLostError || isPersistenceRace(error);
}

function idempotencyConflict(): ConflictException {
  return new ConflictException({
    code: "IDEMPOTENCY_KEY_REUSED",
    message: "Idempotency key was already used for a different request",
  });
}

function questAlreadyCompleted(): ConflictException {
  return new ConflictException({
    code: "QUEST_ALREADY_COMPLETED",
    message: "Quest has already been completed",
  });
}

function questActionNotFound(): NotFoundException {
  return new NotFoundException("Quest action not found");
}

class QuestClaimLostError extends Error {}
