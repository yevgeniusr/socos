import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { NotificationsService } from "../notifications/notifications.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import { ReminderType } from "./reminders.dto.js";
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
  const tx = {
    contact: {
      findFirst: jest.fn().mockResolvedValue(contact),
    },
    reminder: {
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
    sendReminderNotification: jest.fn(),
  };
  const service = new RemindersService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsService
  );
  return { notifications, prisma, service, tx };
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
