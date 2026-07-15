import { PrismaService } from "../../prisma/prisma.service.js";
import { NotificationSchedulerService } from "../notification-scheduler.service.js";
import { NotificationsService } from "../notifications.service.js";

describe("NotificationSchedulerService", () => {
  it("has no hourly celebration fan-out or unbounded celebration query", async () => {
    const prisma = {
      reminder: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      contactCelebration: {
        findMany: jest.fn(),
      },
    };
    const notifications = {
      sendReminderNotification: jest.fn(),
      sendCelebrationNotification: jest.fn(),
    };
    const service = new NotificationSchedulerService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService
    );

    expect(
      (
        service as unknown as {
          handleUpcomingCelebrations?: unknown;
        }
      ).handleUpcomingCelebrations
    ).toBeUndefined();

    await service.handleDueReminders();
    await service.markOverdueReminders();

    expect(prisma.contactCelebration.findMany).not.toHaveBeenCalled();
    expect(notifications.sendCelebrationNotification).not.toHaveBeenCalled();
    expect(prisma.reminder.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.reminder.updateMany).toHaveBeenCalledTimes(1);
  });

  it("logs only opaque reminder identifiers and aggregates for due delivery", async () => {
    const scheduledAt = new Date("2026-07-16T08:00:00Z");
    const prisma = {
      reminder: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "reminder-opaque-success",
            ownerId: "owner-synthetic",
            type: "birthday",
            scheduledAt,
            description: null,
            contact: {
              id: "contact-success",
              firstName: "PrivateSuccess",
              lastName: "Contact",
            },
          },
          {
            id: "reminder-opaque-failure",
            ownerId: "owner-synthetic",
            type: "followup",
            scheduledAt,
            description: null,
            contact: {
              id: "contact-failure",
              firstName: "PrivateFailure",
              lastName: "Contact",
            },
          },
        ]),
      },
    };
    const notifications = {
      sendReminderNotification: jest
        .fn()
        .mockResolvedValueOnce({ results: [] })
        .mockRejectedValueOnce(
          new Error("provider rejected PrivateFailure Contact")
        ),
    };
    const logger = {
      log: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const service = new NotificationSchedulerService(
      prisma as unknown as PrismaService,
      notifications as unknown as NotificationsService
    );
    (
      service as unknown as {
        logger: typeof logger;
      }
    ).logger = logger;

    await service.handleDueReminders();

    const logged = Object.values(logger)
      .flatMap((method) => method.mock.calls.flat())
      .join(" ");
    expect(logged).toContain("reminder-opaque-success");
    expect(logged).toContain("reminder-opaque-failure");
    expect(logged).toContain("Reminder batch complete: 1 sent, 1 failed");
    expect(logged).not.toContain("PrivateSuccess");
    expect(logged).not.toContain("PrivateFailure");
  });
});
