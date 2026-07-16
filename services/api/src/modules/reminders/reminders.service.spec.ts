import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { NotificationsService } from "../notifications/notifications.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { ReminderType, RepeatInterval } from "./reminders.dto.js";
import { RemindersService } from "./reminders.service.js";

const ownerId = "owner-synthetic";
const contactId = "contact-synthetic";
const scheduledAt = new Date("2026-07-20T12:00:00.000Z");
const input = {
  contactId,
  type: ReminderType.FOLLOWUP,
  title: "Follow up",
  description: "Ask about the project",
  scheduledAt: scheduledAt.toISOString(),
};

function harness(
  contact: { id: string; ownerId: string; isDemo: boolean } | null = {
    id: contactId,
    ownerId,
    isDemo: false,
  }
) {
  const recurringReminder = {
    id: "reminder-synthetic",
    contactId,
    ownerId,
    type: ReminderType.FOLLOWUP,
    title: "Follow up",
    description: "Ask about the project",
    scheduledAt,
    repeatInterval: RepeatInterval.WEEKLY,
    isRecurring: true,
    status: "pending",
    contact: {
      ownerId,
      isDemo: false,
      firstName: "Synthetic",
      lastName: "Contact",
    },
  };
  const completedReminder = {
    ...recurringReminder,
    status: "completed",
    completedAt: new Date("2026-07-16T12:00:00.000Z"),
  };
  const tx = {
    contact: {
      findFirst: jest.fn().mockResolvedValue(contact),
    },
    reminder: {
      findFirst: jest.fn().mockResolvedValue(recurringReminder),
      findUniqueOrThrow: jest.fn().mockResolvedValue(completedReminder),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue(completedReminder),
      create: jest.fn().mockResolvedValue({
        id: "reminder-synthetic",
        contactId,
        type: ReminderType.FOLLOWUP,
        title: "Follow up",
        scheduledAt,
        status: "pending",
        contact: { firstName: "Synthetic", lastName: "Contact" },
      }),
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
    contact: tx.contact,
    reminder: tx.reminder,
  };
  const notifications = {
    sendReminderNotification: jest.fn().mockResolvedValue(undefined),
  };
  const service = new RemindersService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService
  );
  return {
    completedReminder,
    notifications,
    prisma,
    recurringReminder,
    service,
    tx,
  };
}

describe("RemindersService agent commands", () => {
  it("persists with the supplied transaction and never sends a notification", async () => {
    const { notifications, prisma, service, tx } = harness();

    await expect(
      service.createForAgent(ownerId, input, tx as never)
    ).resolves.toEqual({
      reminderId: "reminder-synthetic",
      contactId,
      type: ReminderType.FOLLOWUP,
      title: "Follow up",
      scheduledAt,
      status: "pending",
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.contact.findFirst).toHaveBeenCalledWith({
      where: { id: contactId, ownerId, isDemo: false },
      select: { id: true, ownerId: true, isDemo: true },
    });
    expect(tx.reminder.create).toHaveBeenCalledWith({
      data: {
        contactId,
        ownerId,
        type: ReminderType.FOLLOWUP,
        title: "Follow up",
        description: "Ask about the project",
        scheduledAt,
        repeatInterval: undefined,
        isRecurring: false,
      },
      select: {
        id: true,
        contactId: true,
        type: true,
        title: true,
        scheduledAt: true,
        status: true,
      },
    });
    expect(notifications.sendReminderNotification).not.toHaveBeenCalled();
  });

  it("opens a serializable transaction when the caller does not supply one", async () => {
    const { prisma, service } = harness();

    await service.createForAgent(ownerId, input);

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it.each([
    ["cross-owner", { id: contactId, ownerId: "owner-foreign", isDemo: false }],
    ["demo", { id: contactId, ownerId, isDemo: true }],
  ])(
    "rejects a %s contact without persistence or notification",
    async (_label, contact) => {
      const { notifications, service, tx } = harness(contact);

      await expect(
        service.createForAgent(ownerId, input, tx as never)
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.reminder.create).not.toHaveBeenCalled();
      expect(notifications.sendReminderNotification).not.toHaveBeenCalled();
    }
  );

  it("rolls back persistence failures without notifying", async () => {
    const { notifications, service, tx } = harness();
    tx.reminder.create.mockRejectedValue(new Error("reminder insert failed"));

    await expect(service.createForAgent(ownerId, input)).rejects.toThrow(
      "reminder insert failed"
    );
    expect(notifications.sendReminderNotification).not.toHaveBeenCalled();
  });

  it("keeps human REST notification behavior compatible", async () => {
    const { notifications, service } = harness({
      id: contactId,
      ownerId,
      isDemo: false,
    });
    notifications.sendReminderNotification.mockResolvedValue(undefined);

    await service.create(ownerId, input);

    expect(notifications.sendReminderNotification).toHaveBeenCalledTimes(1);
  });

  it("rejects human reminder creation for a demo contact", async () => {
    const { notifications, service, tx } = harness({
      id: contactId,
      ownerId,
      isDemo: true,
    });

    await expect(service.create(ownerId, input)).rejects.toBeInstanceOf(
      NotFoundException
    );

    expect(tx.contact.findFirst).toHaveBeenCalledWith({
      where: { id: contactId, ownerId, isDemo: false },
    });
    expect(tx.reminder.create).not.toHaveBeenCalled();
    expect(notifications.sendReminderNotification).not.toHaveBeenCalled();
  });

  it("requires contact-owner parity in every upcoming reminder query", async () => {
    const { service, tx } = harness();

    await service.getUpcoming(ownerId);

    const reminderQueries = [
      ...tx.reminder.findMany.mock.calls,
      ...tx.reminder.groupBy.mock.calls,
      ...tx.reminder.count.mock.calls,
    ];
    expect(reminderQueries).toHaveLength(5);
    for (const [query] of reminderQueries) {
      expect(query.where).toEqual(
        expect.objectContaining({
          ownerId,
          contact: { ownerId, isDemo: false },
        })
      );
    }
  });
});

describe("RemindersService completion", () => {
  const completedAt = new Date("2026-07-16T12:00:00.000Z");

  beforeEach(() => jest.useFakeTimers().setSystemTime(completedAt));
  afterEach(() => jest.useRealTimers());

  it("claims a recurring pending reminder once and creates only one successor", async () => {
    const { notifications, prisma, service, tx } = harness();
    tx.reminder.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    notifications.sendReminderNotification.mockResolvedValue(undefined);

    await expect(
      service.complete(ownerId, "reminder-synthetic")
    ).resolves.toEqual(expect.objectContaining({ status: "completed" }));
    await expect(
      service.complete(ownerId, "reminder-synthetic")
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenNthCalledWith(1, expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.reminder.findFirst).toHaveBeenCalledWith({
      where: {
        id: "reminder-synthetic",
        ownerId,
        status: "pending",
        contact: { ownerId, isDemo: false },
      },
      select: {
        id: true,
        contactId: true,
        ownerId: true,
        type: true,
        title: true,
        description: true,
        scheduledAt: true,
        repeatInterval: true,
        isRecurring: true,
        status: true,
        contact: {
          select: {
            ownerId: true,
            isDemo: true,
          },
        },
      },
    });
    expect(tx.reminder.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "reminder-synthetic", ownerId, status: "pending" },
      data: { status: "completed", completedAt },
    });
    expect(tx.reminder.create).toHaveBeenCalledTimes(1);
    expect(tx.reminder.create).toHaveBeenCalledWith({
      data: {
        contactId,
        ownerId,
        type: ReminderType.FOLLOWUP,
        title: "Follow up",
        description: "Ask about the project",
        scheduledAt: new Date("2026-07-27T12:00:00.000Z"),
        repeatInterval: RepeatInterval.WEEKLY,
        isRecurring: true,
      },
    });
    expect(notifications.sendReminderNotification).toHaveBeenCalledTimes(1);
  });

  it("rejects a lost concurrent claim without a successor or notification", async () => {
    const { notifications, service, tx } = harness();
    tx.reminder.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.complete(ownerId, "reminder-synthetic")
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(tx.reminder.create).not.toHaveBeenCalled();
    expect(tx.reminder.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(notifications.sendReminderNotification).not.toHaveBeenCalled();
  });

  it("rolls back the claim with successor failures and never notifies", async () => {
    const { notifications, prisma, service, tx } = harness();
    tx.reminder.create.mockRejectedValue(new Error("successor insert failed"));

    await expect(
      service.complete(ownerId, "reminder-synthetic")
    ).rejects.toThrow("successor insert failed");

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.reminder.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.reminder.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(notifications.sendReminderNotification).not.toHaveBeenCalled();
  });

  it("completes a non-recurring reminder without creating a successor", async () => {
    const { recurringReminder, service, tx } = harness();
    tx.reminder.findFirst.mockResolvedValue({
      ...recurringReminder,
      isRecurring: false,
      repeatInterval: null,
    });

    await expect(
      service.complete(ownerId, "reminder-synthetic")
    ).resolves.toEqual(expect.objectContaining({ status: "completed" }));

    expect(tx.reminder.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.reminder.create).not.toHaveBeenCalled();
    expect(tx.reminder.findUniqueOrThrow).toHaveBeenCalledTimes(1);
  });

  it("notifies only after the transaction commits", async () => {
    const { notifications, prisma, service, tx } = harness();
    const events: string[] = [];
    prisma.$transaction.mockImplementation(async (callback) => {
      const result = await callback(tx);
      events.push("committed");
      return result;
    });
    notifications.sendReminderNotification.mockImplementation(() => {
      events.push("notified");
      return Promise.resolve();
    });

    await service.complete(ownerId, "reminder-synthetic");

    expect(events).toEqual(["committed", "notified"]);
  });

  it("does not notify when the transaction cannot commit", async () => {
    const { notifications, prisma, service, tx } = harness();
    prisma.$transaction.mockImplementation(async (callback) => {
      await callback(tx);
      throw new Error("commit failed");
    });

    await expect(
      service.complete(ownerId, "reminder-synthetic")
    ).rejects.toThrow("commit failed");

    expect(notifications.sendReminderNotification).not.toHaveBeenCalled();
  });
});
