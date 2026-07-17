import { expect, test, type Page, type Route } from "@playwright/test";
import type { ProposalHistoryResponse } from "../src/lib/cockpit-contracts";

const now = "2026-07-17T08:00:00.000Z";

const brief = {
  schemaVersion: "1.1",
  briefId: "brief-synthetic",
  localDate: "2026-07-17",
  timeZone: "Asia/Dubai",
  generatedAt: now,
  people: [
    {
      itemId: "person-item",
      rank: 1,
      contact: { id: "contact-synthetic", name: "Synthetic Person" },
      health: { score: 44, band: "needs-attention" },
      lastInteractionAt: null,
      reason: "A synthetic follow-up is due.",
      evidence: [{ code: "days_overdue", value: 61 }],
      state: "pending",
    },
  ],
  dates: [
    {
      itemId: "date-item",
      rank: 1,
      contact: { id: "contact-date", name: "Synthetic Friend" },
      type: "birthday",
      title: "Synthetic Friend's birthday",
      date: "2026-07-18",
      daysAway: 1,
      reason: "Tomorrow",
      state: "pending",
    },
  ],
  events: [
    {
      itemId: "event-item",
      rank: 1,
      source: { type: "discovered_event", id: "event-source" },
      title: "Synthetic learning meetup",
      startsAt: "2026-07-18T14:00:00.000Z",
      endsAt: "2026-07-18T16:00:00.000Z",
      city: "Dubai",
      reason: "Matches learning plans",
      evidence: {
        components: {
          time: 1,
          distance: 1,
          interests: 1,
          social: 1,
          contact: 1,
          novelty: 1,
          feedback: 1,
        },
        distanceBand: "2-10",
        conflict: "clear",
        context: { source: "fallback", freshness: "fallback" },
        matchedTags: ["learning"],
        category: "learning",
        plannedCity: "Dubai",
      },
      state: "pending",
    },
  ],
  quests: [
    {
      questId: "interaction-quest",
      itemId: "person-item",
      title: "Log a synthetic interaction",
      completionType: "interaction",
      xpReward: 20,
      status: "pending",
    },
    {
      questId: "reminder-quest",
      itemId: "date-item",
      title: "Complete the synthetic reminder",
      completionType: "reminder",
      xpReward: 15,
      status: "pending",
    },
  ],
  allowedActions: ["accept", "snooze", "dismiss", "complete"],
} as const;

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

interface ApiState {
  feedback: Array<{ body: Record<string, unknown>; key: string }>;
  interactionBodies: Array<Record<string, unknown>>;
  interactionKeys: string[];
  questBodies: Array<Record<string, unknown>>;
  questCompletionKeys: string[];
  completedReminders: string[];
  reminderQuestCompletionCalls: number;
  decisions: string[];
  approvedHistoryRequestsAfterDecision: number;
  failFirstKeep: boolean;
  failFirstSnooze: boolean;
  reminderBodies: Array<Record<string, unknown>>;
  reminderKeys: string[];
  generateCalls: number;
  releaseFeedback: () => void;
  releaseQuestComplete: () => void;
  releaseReminderCreate: () => void;
  releaseStats: () => void;
}

async function installApi(
  page: Page,
  options: {
    briefReady?: boolean;
    failApprovals?: boolean;
    failBriefAfterQuest?: boolean;
    holdFeedback?: boolean;
    holdQuestComplete?: boolean;
    holdReminderCreate?: boolean;
    loseFirstReminderQuestResponse?: boolean;
    loseFirstInteractionResponse?: boolean;
    loseFirstReminderCreateResponse?: boolean;
    loseFirstQuestCompletionResponse?: boolean;
    mismatchFirstQuestCompletionResponse?: boolean;
    durableApprovedHistoryThenOmitAndFail?: boolean;
    failRejectedHistoryAfterDecision?: boolean;
    briefTimeZone?: string;
    statsMode?: "ready" | "deferred-error";
  } = {}
): Promise<ApiState> {
  let releaseFeedback: () => void = () => undefined;
  const feedbackGate = new Promise<void>((resolve) => {
    releaseFeedback = resolve;
  });
  let releaseQuestComplete: () => void = () => undefined;
  const questCompleteGate = new Promise<void>((resolve) => {
    releaseQuestComplete = resolve;
  });
  let releaseReminderCreate: () => void = () => undefined;
  const reminderCreateGate = new Promise<void>((resolve) => {
    releaseReminderCreate = resolve;
  });
  let releaseStats: () => void = () => undefined;
  const statsGate = new Promise<void>((resolve) => {
    releaseStats = resolve;
  });
  const state: ApiState = {
    feedback: [],
    interactionBodies: [],
    interactionKeys: [],
    questBodies: [],
    questCompletionKeys: [],
    completedReminders: [],
    reminderQuestCompletionCalls: 0,
    decisions: [],
    approvedHistoryRequestsAfterDecision: 0,
    failFirstKeep: true,
    failFirstSnooze: true,
    reminderBodies: [],
    reminderKeys: [],
    generateCalls: 0,
    releaseFeedback,
    releaseQuestComplete,
    releaseReminderCreate,
    releaseStats,
  };
  let briefReady = options.briefReady ?? true;
  let reminderQuestCompleted = false;
  let proposals: ProposalHistoryResponse["proposals"] = [
    {
      id: "proposal-approve",
      actionType: "message",
      preview: {
        type: "message",
        contact: { id: "contact-synthetic", name: "Synthetic Person" },
        channel: "social",
        body: "Synthetic draft",
      },
      status: "pending",
      expiresAt: "2026-07-18T08:00:00.000Z",
      decidedAt: null,
      createdAt: now,
      client: { id: "client-synthetic", name: "Hermes Synthetic" },
      grant: null,
    },
    {
      id: "proposal-reject",
      actionType: "invitation",
      preview: {
        type: "invitation",
        contact: { id: "contact-date", name: "Synthetic Friend" },
        title: "Synthetic invitation",
        scheduledAt: null,
      },
      status: "pending",
      expiresAt: "2026-07-18T08:00:00.000Z",
      decidedAt: null,
      createdAt: now,
      client: { id: "client-synthetic", name: "Hermes Synthetic" },
      grant: null,
    },
  ];
  await page.addInitScript(() => {
    localStorage.setItem("socos_token", "synthetic-token");
    localStorage.setItem(
      "socos_user",
      JSON.stringify({
        id: "owner-synthetic",
        email: "owner@example.test",
        name: "Synthetic Owner",
        xp: 120,
        level: 3,
      })
    );
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.pathname === "/api/gamification/stats") {
      if (options.statsMode === "deferred-error") {
        await statsGate;
        return json(route, { message: "Synthetic stats failure" }, 503);
      }
      return json(route, {
        user: {
          id: "owner-synthetic",
          email: "owner@example.test",
          name: "Synthetic Owner",
          xp: 120,
          level: 3,
        },
        stats: {
          totalContacts: 106,
          totalInteractions: 20,
          xpProgress: 20,
          xpNeeded: 100,
          levelName: "Connector",
        },
      });
    }
    if (url.pathname === "/api/gamification/streak")
      return json(route, {
        streakDays: 4,
        lastActiveAt: now,
        checkedInToday: true,
        checkedInYesterday: true,
        streakAtRisk: false,
      });
    if (
      url.pathname === "/api/briefs/today" &&
      options.failBriefAfterQuest &&
      state.questBodies.length > 0
    )
      return json(route, { message: "Synthetic brief refresh failure" }, 503);
    if (url.pathname === "/api/briefs/today")
      return briefReady
        ? json(route, {
            ...brief,
            timeZone: options.briefTimeZone ?? brief.timeZone,
          })
        : json(
            route,
            {
              code: "BRIEF_NOT_READY",
              message: "Today's brief is not ready.",
            },
            404
          );
    if (url.pathname === "/api/briefs/generate" && method === "POST") {
      state.generateCalls += 1;
      briefReady = true;
      return json(route, {
        ...brief,
        timeZone: options.briefTimeZone ?? brief.timeZone,
      });
    }
    if (url.pathname === "/api/reminders/upcoming")
      return json(route, {
        reminders: [
          {
            id: "upcoming-reminder",
            title: "Synthetic upcoming reminder",
            type: "followup",
            scheduledAt: "2026-07-18T09:00:00.000Z",
            status: "pending",
            contact: {
              id: "contact-synthetic",
              firstName: "Synthetic",
              lastName: "Person",
              photo: null,
            },
          },
        ],
        stats: { today: 0, thisWeek: 1, overdue: 0 },
      });
    if (url.pathname === "/api/agent-proposals/history") {
      const requestedStatus = url.searchParams.get("status");
      const approvedDecisionRecorded = state.decisions.includes(
        "proposal-approve:approve"
      );
      if (
        options.durableApprovedHistoryThenOmitAndFail &&
        requestedStatus === "approved" &&
        approvedDecisionRecorded
      ) {
        state.approvedHistoryRequestsAfterDecision += 1;
      }
      const rejectedRefreshShouldFail =
        options.failRejectedHistoryAfterDecision &&
        requestedStatus === "rejected" &&
        state.decisions.includes("proposal-reject:reject");
      const approvedRefreshShouldFail =
        options.durableApprovedHistoryThenOmitAndFail &&
        requestedStatus === "approved" &&
        state.approvedHistoryRequestsAfterDecision >= 3;
      if (
        options.failApprovals ||
        rejectedRefreshShouldFail ||
        approvedRefreshShouldFail
      ) {
        return json(route, { message: "Synthetic approval failure" }, 503);
      }
      let visibleProposals =
        requestedStatus && requestedStatus !== "all"
          ? proposals.filter(
              (proposal) => proposal.status === requestedStatus
            )
          : proposals;
      if (
        options.durableApprovedHistoryThenOmitAndFail &&
        requestedStatus === "approved" &&
        state.approvedHistoryRequestsAfterDecision === 1
      ) {
        visibleProposals = visibleProposals.map((proposal) =>
          proposal.id === "proposal-approve"
            ? {
                ...proposal,
                preview: {
                  type: "message",
                  contact: {
                    id: "contact-synthetic",
                    name: "Synthetic Person",
                  },
                  channel: "social",
                  body: "Changed durable draft",
                },
                grant: {
                  status: "consumed",
                  expiresAt: "2026-07-17T08:15:00.000Z",
                  consumedAt: now,
                  revokedAt: null,
                  outbox: {
                    status: "processing",
                    attempts: 1,
                    completedAt: null,
                    lastErrorCode: null,
                  },
                },
              }
            : proposal
        );
      }
      if (
        options.durableApprovedHistoryThenOmitAndFail &&
        requestedStatus === "approved" &&
        state.approvedHistoryRequestsAfterDecision === 2
      ) {
        visibleProposals = visibleProposals.filter(
          (proposal) => proposal.id !== "proposal-approve"
        );
      }
      return json(route, {
        proposals: visibleProposals,
        total: visibleProposals.length,
        offset: 0,
        limit: 20,
      });
    }
    if (url.pathname === "/api/reminders" && method === "POST") {
      state.reminderBodies.push(
        request.postDataJSON() as Record<string, unknown>
      );
      state.reminderKeys.push(request.headers()["idempotency-key"] ?? "");
      if (options.holdReminderCreate) await reminderCreateGate;
      if (
        options.loseFirstReminderCreateResponse &&
        state.reminderBodies.length === 1
      )
        return json(
          route,
          { message: "Synthetic lost reminder response" },
          503
        );
      return json(route, { id: "created-reminder" });
    }
    const feedback = url.pathname.match(
      /^\/api\/briefs\/items\/([^/]+)\/feedback$/
    );
    if (feedback && method === "POST") {
      const entry = {
        body: request.postDataJSON() as Record<string, unknown>,
        key: request.headers()["idempotency-key"] ?? "",
      };
      state.feedback.push(entry);
      if (options.holdFeedback && entry.body.action === "dismiss") {
        await feedbackGate;
      }
      if (entry.body.action === "accept" && state.failFirstKeep) {
        state.failFirstKeep = false;
        return json(route, { message: "Synthetic retry" }, 503);
      }
      if (entry.body.action === "snooze" && state.failFirstSnooze) {
        state.failFirstSnooze = false;
        return json(route, { message: "Synthetic snooze retry" }, 503);
      }
      return json(route, {
        feedbackId: "feedback-synthetic",
        itemId: feedback[1],
        action: entry.body.action,
        status: entry.body.action,
      });
    }
    if (url.pathname === "/api/briefs/quests/interaction-quest/action")
      return json(route, {
        questId: "interaction-quest",
        completionType: "interaction",
        contact: { id: "contact-synthetic", name: "Synthetic Person" },
      });
    if (url.pathname === "/api/briefs/quests/reminder-quest/action")
      return json(route, {
        questId: "reminder-quest",
        completionType: "reminder",
        contact: { id: "contact-date", name: "Synthetic Friend" },
        reminder: {
          id: "quest-reminder-target",
          title: "Synthetic target reminder",
          scheduledAt: "2026-07-18T10:00:00.000Z",
          status: reminderQuestCompleted ? "completed" : "pending",
        },
      });
    if (
      url.pathname === "/api/contacts/contact-synthetic/interactions" &&
      method === "POST"
    ) {
      state.interactionBodies.push(
        request.postDataJSON() as Record<string, unknown>
      );
      state.interactionKeys.push(request.headers()["idempotency-key"] ?? "");
      if (
        options.loseFirstInteractionResponse &&
        state.interactionBodies.length === 1
      )
        return json(
          route,
          { message: "Synthetic lost interaction response" },
          503
        );
      return json(route, { interaction: { id: "interaction-evidence" } });
    }
    const questComplete = url.pathname.match(
      /^\/api\/briefs\/quests\/([^/]+)\/complete$/
    );
    if (questComplete && method === "POST") {
      state.questBodies.push(request.postDataJSON() as Record<string, unknown>);
      state.questCompletionKeys.push(
        request.headers()["idempotency-key"] ?? ""
      );
      if (options.holdQuestComplete) await questCompleteGate;
      if (
        options.loseFirstQuestCompletionResponse &&
        state.questBodies.length === 1
      )
        return json(
          route,
          { message: "Synthetic lost quest completion response" },
          503
        );
      if (
        options.mismatchFirstQuestCompletionResponse &&
        state.questBodies.length === 1
      )
        return json(route, {
          feedbackId: "quest-feedback",
          questId: "different-quest",
          status: "completed",
          completedAt: now,
          xpAwarded: 20,
        });
      return json(route, {
        feedbackId: "quest-feedback",
        questId: questComplete[1],
        status: "completed",
        completedAt: now,
        xpAwarded: questComplete[1] === "reminder-quest" ? 15 : 20,
      });
    }
    const reminderComplete = url.pathname.match(
      /^\/api\/reminders\/([^/]+)\/complete$/
    );
    if (reminderComplete && method === "PUT") {
      if (reminderComplete[1] === "quest-reminder-target") {
        state.reminderQuestCompletionCalls += 1;
        if (reminderQuestCompleted) {
          return json(route, { message: "Reminder is already completed" }, 409);
        }
        reminderQuestCompleted = true;
        state.completedReminders.push(reminderComplete[1]);
        if (options.loseFirstReminderQuestResponse) {
          return route.abort("failed");
        }
        return json(route, { id: reminderComplete[1], status: "completed" });
      }
      state.completedReminders.push(reminderComplete[1]);
      return json(route, { id: reminderComplete[1], status: "completed" });
    }
    const decision = url.pathname.match(
      /^\/api\/agent-proposals\/([^/]+)\/(approve|reject)$/
    );
    if (decision && method === "POST") {
      state.decisions.push(`${decision[1]}:${decision[2]}`);
      proposals = proposals.map((proposal) =>
        proposal.id === decision[1]
          ? {
              ...proposal,
              status: decision[2] === "approve" ? "approved" : "rejected",
              decidedAt: now,
              grant:
                decision[2] === "approve"
                  ? {
                      status: "active",
                      expiresAt: "2026-07-17T08:15:00.000Z",
                      consumedAt: null,
                      revokedAt: null,
                      outbox: null,
                    }
                  : null,
            }
          : proposal
      );
      return json(route, { id: decision[1], status: decision[2] });
    }
    return json(
      route,
      { message: `Unhandled synthetic route ${method} ${url.pathname}` },
      404
    );
  });
  return state;
}

test("performs durable cockpit actions with exact contracts", async ({
  page,
}) => {
  const api = await installApi(page, {
    durableApprovedHistoryThenOmitAndFail: true,
    failRejectedHistoryAfterDecision: true,
  });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard\/today$/);
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

  const person = page
    .locator("li")
    .filter({ hasText: "Synthetic Person" })
    .first();
  await person.getByRole("button", { name: "Keep" }).click();
  await expect(person.getByRole("alert")).toContainText("Synthetic retry");
  await person.getByRole("button", { name: "Keep" }).click();
  await expect.poll(() => api.feedback.length).toBe(2);
  expect(api.feedback[0].key).toBe(api.feedback[1].key);
  expect(api.feedback[0].key).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
  expect(api.feedback[0].body).toEqual({ action: "accept" });

  await person.getByRole("button", { name: "Snooze" }).click();
  await page.getByText("7 days").click();
  await page
    .getByRole("dialog", { name: "Snooze suggestion" })
    .getByRole("button", { name: "Snooze" })
    .click();
  const snoozeDialog = page.getByRole("dialog", { name: "Snooze suggestion" });
  await expect(snoozeDialog.getByRole("alert")).toContainText(
    "Synthetic snooze retry"
  );
  await snoozeDialog.getByRole("button", { name: "Snooze" }).click();
  const snoozes = api.feedback.filter(
    (entry) => entry.body.action === "snooze"
  );
  expect(snoozes).toHaveLength(2);
  expect(snoozes[0].key).toBe(snoozes[1].key);
  expect(snoozes[0].body).toEqual(snoozes[1].body);
  expect(snoozes[1].body).toMatchObject({
    action: "snooze",
    snoozedUntil: expect.any(String),
  });

  const event = page
    .locator("li")
    .filter({ hasText: "Synthetic learning meetup" });
  await event.getByRole("button", { name: "Dismiss" }).click();
  const dismissDialog = page.getByRole("dialog", {
    name: "Dismiss suggestion",
  });
  await dismissDialog.getByRole("textbox").fill("Not today");
  await dismissDialog.getByRole("button", { name: "Dismiss" }).click();
  expect(api.feedback.at(-1)?.body).toEqual({
    action: "dismiss",
    reason: "Not today",
  });

  await person.getByRole("button", { name: "Create reminder" }).click();
  await page
    .getByRole("dialog", { name: "Create reminder" })
    .getByRole("button", { name: "Create reminder" })
    .click();
  await expect.poll(() => api.reminderBodies.length).toBe(1);
  expect(api.reminderBodies[0]).toMatchObject({
    contactId: "contact-synthetic",
    type: "followup",
    title: "Follow up with Synthetic Person",
    scheduledAt: expect.any(String),
  });
  expect(api.reminderKeys[0]).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
  await page
    .locator("li")
    .filter({ hasText: "Synthetic upcoming reminder" })
    .getByRole("button", { name: "Complete" })
    .click();
  await expect
    .poll(() => api.completedReminders)
    .toContain("upcoming-reminder");

  const interactionQuest = page
    .locator("li")
    .filter({ hasText: "Log a synthetic interaction" });
  await interactionQuest
    .getByRole("button", { name: "Complete quest" })
    .click();
  const interactionDialog = page.getByRole("dialog", {
    name: "Log a synthetic interaction",
  });
  await interactionDialog
    .getByRole("textbox", { name: "Title" })
    .fill("Synthetic conversation");
  await interactionDialog
    .getByRole("textbox", { name: "Notes" })
    .fill("Synthetic verified notes");
  await interactionDialog
    .getByRole("button", { name: "Log and verify" })
    .click();
  await expect
    .poll(() => api.questBodies)
    .toContainEqual({ interactionId: "interaction-evidence" });
  expect(api.interactionKeys[0]).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
  await expect(page.getByRole("heading", { name: "Quest verified" })).toBeFocused();
  await expect(page.getByText("Interaction evidence verified")).toBeVisible();
  await expect(page.getByText("+20 XP awarded")).toBeVisible();
  await expect(page.getByText("Verified Jul 17, 12:00 PM")).toBeVisible();

  const reminderQuest = page
    .locator("li")
    .filter({ hasText: "Complete the synthetic reminder" });
  await reminderQuest.getByRole("button", { name: "Complete quest" }).click();
  await page
    .getByRole("dialog", { name: "Complete the synthetic reminder" })
    .getByRole("button", { name: "Complete and verify" })
    .click();
  await expect
    .poll(() => api.completedReminders)
    .toContain("quest-reminder-target");
  await expect
    .poll(() => api.questBodies)
    .toContainEqual({ reminderId: "quest-reminder-target" });
  await expect(page.getByRole("heading", { name: "Quest verified" })).toBeFocused();
  await expect(page.getByText("Reminder evidence verified")).toBeVisible();
  await expect(page.getByText("+15 XP awarded")).toBeVisible();

  await page.getByRole("link", { name: /pending approvals/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/approvals\?status=pending$/);
  const message = page.locator("li").filter({ hasText: "Synthetic draft" });
  await message.getByRole("button", { name: "Approve" }).click();
  await expect.poll(() => api.decisions).toContain("proposal-approve:approve");
  await expect(page).toHaveURL(/\/dashboard\/approvals\?status=approved$/);
  await expect
    .poll(() => api.approvedHistoryRequestsAfterDecision)
    .toBe(1);
  await expect(
    message.getByText("Synthetic draft", { exact: true })
  ).toBeVisible();
  await expect(
    message.getByRole("heading", { name: "Decision receipt" })
  ).toBeFocused();
  await expect(
    message.getByText("Approval granted", { exact: true })
  ).toBeVisible();
  await expect(message.getByText("Execution running")).toBeVisible();
  await expect(
    message.getByText("XP or quest progress not reported")
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Approval recorded" })
  ).toBeVisible();
  await expect(page.getByText("Sent")).toHaveCount(0);
  await page.getByRole("link", { name: "pending" }).click();
  await expect(page).toHaveURL(/\/dashboard\/approvals\?status=pending$/);
  await page.getByRole("link", { name: "approved" }).click();
  await expect(page).toHaveURL(/\/dashboard\/approvals\?status=approved$/);
  await expect
    .poll(() => api.approvedHistoryRequestsAfterDecision)
    .toBe(2);
  await expect(message.getByText("Synthetic draft", { exact: true })).toBeVisible();
  await expect(message.getByText("Execution running")).toBeVisible();
  await expect(message.getByText("Execution not requested")).toHaveCount(0);
  await page.getByRole("link", { name: "pending" }).click();
  await expect(page).toHaveURL(/\/dashboard\/approvals\?status=pending$/);
  await page.getByRole("link", { name: "approved" }).click();
  await expect(page).toHaveURL(/\/dashboard\/approvals\?status=approved$/);
  await expect
    .poll(() => api.approvedHistoryRequestsAfterDecision)
    .toBe(3);
  await expect(page.getByText("Synthetic approval failure")).toBeVisible();
  await expect(message.getByText("Synthetic draft", { exact: true })).toBeVisible();
  await expect(message.getByText("Execution running")).toBeVisible();
  await page.getByRole("link", { name: "pending" }).click();
  await expect(page).toHaveURL(/\/dashboard\/approvals\?status=pending$/);
  const invitation = page
    .locator("li")
    .filter({ hasText: "Synthetic invitation" });
  await invitation.getByRole("button", { name: "Reject" }).click();
  await expect.poll(() => api.decisions).toContain("proposal-reject:reject");
  await expect(page).toHaveURL(/\/dashboard\/approvals\?status=rejected$/);
  await expect(
    invitation.getByText("Synthetic invitation", { exact: true })
  ).toBeVisible();
  await expect(
    invitation.getByRole("heading", { name: "Decision receipt" })
  ).toBeFocused();
  await expect(invitation.getByText("Nothing sent")).toBeVisible();
  await expect(
    invitation.getByText("No XP or quest progress awarded")
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Rejection recorded" })
  ).toBeVisible();
});

test("announces and focuses consecutive approval receipts", async ({ page }) => {
  await installApi(page);
  await page.goto("/dashboard/approvals?status=pending");

  const first = page.locator("li").filter({ hasText: "Synthetic draft" });
  await first.getByRole("button", { name: "Approve" }).click();
  await expect(page).toHaveURL(/\/dashboard\/approvals\?status=approved$/);
  await expect(
    first.getByRole("heading", { name: "Decision receipt" })
  ).toBeFocused();
  const liveStatus = page
    .getByRole("status")
    .filter({ hasText: "Approval recorded" });
  await expect(liveStatus).toContainText("Confirmation 1");

  await page.getByRole("link", { name: "pending" }).click();
  const second = page
    .locator("li")
    .filter({ hasText: "Synthetic invitation" });
  await second.getByRole("button", { name: "Approve" }).click();
  await expect(page).toHaveURL(/\/dashboard\/approvals\?status=approved$/);
  await expect(
    second.getByRole("heading", { name: "Decision receipt" })
  ).toBeFocused();
  await expect(liveStatus).toContainText("Confirmation 2");
  await expect(liveStatus).toHaveText(
    /Approval recorded\. Receipt ready\.\s+Confirmation 2\./
  );
});

test("explains focus priority and prefills reminders from structured date context", async ({
  page,
}) => {
  const api = await installApi(page);
  await page.goto("/dashboard/today");

  const person = page
    .locator("li")
    .filter({ hasText: "Synthetic Person" })
    .first();
  await expect(person.getByText("Needs attention · 61 days overdue")).toBeVisible();
  await expect(
    person.getByText("Relationship score 44/100 · No interaction logged")
  ).toBeVisible();

  const importantDate = page
    .locator("li")
    .filter({ hasText: "Synthetic Friend's birthday" });
  await importantDate
    .getByRole("button", { name: "Create reminder" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Create reminder" });
  await expect(dialog.getByLabel("Type")).toHaveValue("birthday");
  await expect(dialog.getByLabel("Title")).toHaveValue(
    "Synthetic Friend's birthday"
  );
  await expect(dialog.getByLabel("Scheduled at")).toHaveValue(
    "2026-07-18T09:00"
  );
  await expect(dialog.getByText("Birthday · Jul 18, 2026")).toBeVisible();
  await dialog.getByRole("button", { name: "Create reminder" }).click();

  await expect.poll(() => api.reminderBodies).toHaveLength(1);
  expect(api.reminderBodies[0]).toEqual({
    contactId: "contact-date",
    type: "birthday",
    title: "Synthetic Friend's birthday",
    scheduledAt: "2026-07-18T05:00:00.000Z",
  });

  await person.getByRole("button", { name: "Create reminder" }).click();
  const followupDialog = page.getByRole("dialog", { name: "Create reminder" });
  await expect(followupDialog.getByLabel("Type")).toHaveValue("followup");
  await expect(followupDialog.getByLabel("Title")).toHaveValue(
    "Follow up with Synthetic Person"
  );
  await expect(followupDialog.getByLabel("Scheduled at")).toHaveValue(
    /^\d{4}-\d{2}-\d{2}T09:00$/
  );
  await followupDialog.getByRole("button", { name: "Close" }).click();
});

test("retries lost committed cockpit POST responses with stable intent keys", async ({
  page,
}) => {
  const api = await installApi(page, {
    loseFirstInteractionResponse: true,
    loseFirstReminderCreateResponse: true,
  });
  await page.goto("/dashboard/today");

  const person = page
    .locator("li")
    .filter({ hasText: "Synthetic Person" })
    .first();
  await person.getByRole("button", { name: "Create reminder" }).click();
  const reminderDialog = page.getByRole("dialog", { name: "Create reminder" });
  await reminderDialog.getByRole("button", { name: "Create reminder" }).click();
  await expect(reminderDialog.getByRole("alert")).toContainText(
    "Synthetic lost reminder response"
  );
  await reminderDialog.getByRole("button", { name: "Create reminder" }).click();
  await expect(reminderDialog).toBeHidden();
  expect(api.reminderBodies).toHaveLength(2);
  expect(api.reminderBodies[1]).toEqual(api.reminderBodies[0]);
  expect(api.reminderKeys[1]).toBe(api.reminderKeys[0]);

  const quest = page
    .locator("li")
    .filter({ hasText: "Log a synthetic interaction" });
  await quest.getByRole("button", { name: "Complete quest" }).click();
  const interactionDialog = page.getByRole("dialog", {
    name: "Log a synthetic interaction",
  });
  await interactionDialog
    .getByRole("textbox", { name: "Title" })
    .fill("Synthetic retry conversation");
  await interactionDialog
    .getByRole("textbox", { name: "Notes" })
    .fill("Synthetic retry notes");
  await interactionDialog
    .getByRole("button", { name: "Log and verify" })
    .click();
  await expect(interactionDialog.getByRole("alert")).toContainText(
    "Synthetic lost interaction response"
  );
  await interactionDialog
    .getByRole("button", { name: "Log and verify" })
    .click();
  await expect(interactionDialog).toBeHidden();
  expect(api.interactionBodies).toHaveLength(2);
  expect(api.interactionBodies[1]).toEqual(api.interactionBodies[0]);
  expect(api.interactionKeys[1]).toBe(api.interactionKeys[0]);
  await expect(
    page.getByRole("heading", { name: "Quest verified" })
  ).toBeFocused();
});

test("retries a lost quest-completion response with one verified receipt", async ({
  page,
}) => {
  const api = await installApi(page, {
    loseFirstQuestCompletionResponse: true,
    failBriefAfterQuest: true,
    briefTimeZone: "America/New_York",
  });
  await page.goto("/dashboard/today");

  const quest = page
    .locator("li")
    .filter({ hasText: "Log a synthetic interaction" });
  await quest.getByRole("button", { name: "Complete quest" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Log a synthetic interaction",
  });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Completed call");
  await dialog.getByRole("textbox", { name: "Notes" }).fill("Verified notes");
  await dialog.getByRole("button", { name: "Log and verify" }).click();

  await expect(dialog.getByRole("alert")).toContainText(
    "Synthetic lost quest completion response"
  );
  await expect(page.getByRole("heading", { name: "Quest verified" })).toHaveCount(0);
  expect(api.interactionBodies).toHaveLength(1);
  expect(api.questCompletionKeys).toHaveLength(1);

  await dialog.getByRole("button", { name: "Retry verification" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("heading", { name: "Quest verified" })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Quest verified" })).toBeFocused();
  await expect(page.getByText("+20 XP awarded")).toHaveCount(1);
  await expect(page.getByText("Verified Jul 17, 4:00 AM")).toBeVisible();
  await expect(page.getByText("Synthetic brief refresh failure")).toBeVisible();
  expect(api.interactionBodies).toHaveLength(1);
  expect(api.questCompletionKeys).toHaveLength(2);
  expect(api.questCompletionKeys[1]).toBe(api.questCompletionKeys[0]);
  expect(api.questCompletionKeys[0]).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
});

test("retries a mismatched committed quest response with the same intent key", async ({
  page,
}) => {
  const api = await installApi(page, {
    mismatchFirstQuestCompletionResponse: true,
  });
  await page.goto("/dashboard/today");

  const quest = page
    .locator("li")
    .filter({ hasText: "Log a synthetic interaction" });
  await quest.getByRole("button", { name: "Complete quest" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Log a synthetic interaction",
  });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Committed call");
  await dialog
    .getByRole("textbox", { name: "Notes" })
    .fill("Durable verification notes");
  await dialog.getByRole("button", { name: "Log and verify" }).click();

  await expect(dialog.getByRole("alert")).toContainText(
    "Quest verification response does not match the request"
  );
  await expect(page.getByRole("heading", { name: "Quest verified" })).toHaveCount(0);
  await expect(page.getByText("+20 XP awarded")).toHaveCount(0);
  expect(api.interactionBodies).toHaveLength(1);
  expect(api.questBodies).toEqual([{ interactionId: "interaction-evidence" }]);
  expect(api.questCompletionKeys).toHaveLength(1);
  expect(api.questCompletionKeys[0]).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);

  await dialog.getByRole("button", { name: "Retry verification" }).click();

  await expect(dialog).toBeHidden();
  const receiptHeading = page.getByRole("heading", { name: "Quest verified" });
  await expect(receiptHeading).toHaveCount(1);
  await expect(receiptHeading).toBeFocused();
  await expect(page.getByText("+20 XP awarded")).toHaveCount(1);
  expect(api.interactionBodies).toHaveLength(1);
  expect(api.questBodies).toEqual([
    { interactionId: "interaction-evidence" },
    { interactionId: "interaction-evidence" },
  ]);
  expect(api.questCompletionKeys).toHaveLength(2);
  expect(api.questCompletionKeys[1]).toBe(api.questCompletionKeys[0]);
});

test("moves focus to the verified receipt after each successful quest", async ({
  page,
}) => {
  await installApi(page);
  await page.goto("/dashboard/today");
  const receiptHeading = page.getByRole("heading", { name: "Quest verified" });

  const interactionQuest = page
    .locator("li")
    .filter({ hasText: "Log a synthetic interaction" });
  await interactionQuest
    .getByRole("button", { name: "Complete quest" })
    .click();
  const interactionDialog = page.getByRole("dialog", {
    name: "Log a synthetic interaction",
  });
  await interactionDialog.getByRole("textbox", { name: "Title" }).fill("Call");
  await interactionDialog.getByRole("textbox", { name: "Notes" }).fill("Done");
  await interactionDialog
    .getByRole("button", { name: "Log and verify" })
    .click();
  await expect(interactionDialog).toBeHidden();
  await expect(receiptHeading).toBeFocused();

  const reminderQuest = page
    .locator("li")
    .filter({ hasText: "Complete the synthetic reminder" });
  await reminderQuest.getByRole("button", { name: "Complete quest" }).click();
  const reminderDialog = page.getByRole("dialog", {
    name: "Complete the synthetic reminder",
  });
  await reminderDialog
    .getByRole("button", { name: "Complete and verify" })
    .click();
  await expect(reminderDialog).toBeHidden();
  await expect(receiptHeading).toBeFocused();
});

test("generates only after explicit command and isolates panel failures", async ({
  page,
}) => {
  const api = await installApi(page, {
    briefReady: false,
    failApprovals: true,
  });
  await page.goto("/dashboard/today");
  const generate = page.getByRole("button", {
    name: "Generate today's brief",
  });
  await expect(generate).toBeVisible();
  expect(api.generateCalls).toBe(0);
  await expect(page.getByText("Synthetic approval failure")).toBeVisible();
  await generate.click();
  await expect.poll(() => api.generateCalls).toBe(1);
  await expect(
    page.getByRole("link", { name: "Synthetic Person" })
  ).toBeVisible();
});

test("contains dialog focus and restores each action trigger", async ({
  page,
}) => {
  await installApi(page);
  await page.goto("/dashboard/today");

  const person = page
    .locator("li")
    .filter({ hasText: "Synthetic Person" })
    .first();
  const snoozeTrigger = person.getByRole("button", { name: "Snooze" });
  await snoozeTrigger.click();
  const snoozeDialog = page.getByRole("dialog", {
    name: "Snooze suggestion",
  });
  const closeSnooze = snoozeDialog.getByRole("button", { name: "Close" });
  const submitSnooze = snoozeDialog.getByRole("button", { name: "Snooze" });
  await closeSnooze.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(submitSnooze).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeSnooze).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(snoozeDialog).toBeHidden();
  await expect(snoozeTrigger).toBeFocused();

  const event = page
    .locator("li")
    .filter({ hasText: "Synthetic learning meetup" });
  const dismissTrigger = event.getByRole("button", { name: "Dismiss" });
  await dismissTrigger.click();
  const dismissDialog = page.getByRole("dialog", {
    name: "Dismiss suggestion",
  });
  const closeDismiss = dismissDialog.getByRole("button", { name: "Close" });
  const submitDismiss = dismissDialog.getByRole("button", { name: "Dismiss" });
  await closeDismiss.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(submitDismiss).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeDismiss).toBeFocused();
  await dismissDialog.locator("..").click({ position: { x: 1, y: 1 } });
  await expect(dismissDialog).toBeHidden();
  await expect(dismissTrigger).toBeFocused();

  const reminderTrigger = person.getByRole("button", {
    name: "Create reminder",
  });
  await reminderTrigger.click();
  const reminderDialog = page.getByRole("dialog", { name: "Create reminder" });
  const closeReminder = reminderDialog.getByRole("button", { name: "Close" });
  const submitReminder = reminderDialog.getByRole("button", {
    name: "Create reminder",
  });
  await closeReminder.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(submitReminder).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeReminder).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(reminderDialog).toBeHidden();
  await expect(reminderTrigger).toBeFocused();

  const quest = page
    .locator("li")
    .filter({ hasText: "Complete the synthetic reminder" });
  const questTrigger = quest.getByRole("button", { name: "Complete quest" });
  await questTrigger.click();
  const questDialog = page.getByRole("dialog", {
    name: "Complete the synthetic reminder",
  });
  const completeQuest = questDialog.getByRole("button", {
    name: "Complete and verify",
  });
  await expect(completeQuest).toBeVisible();
  const closeQuest = questDialog.getByRole("button", { name: "Close" });
  await closeQuest.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(completeQuest).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closeQuest).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(questDialog).toBeHidden();
  await expect(questTrigger).toBeFocused();
});

test("does not fabricate desktop momentum while stats load or fail", async ({
  page,
}) => {
  const api = await installApi(page, { statsMode: "deferred-error" });
  await page.goto("/dashboard/today");
  const sidebar = page.locator("aside").first();

  await expect(
    sidebar.getByText("Momentum loading...", { exact: true })
  ).toBeVisible();
  await expect(sidebar.getByText("Social Novice")).toHaveCount(0);
  await expect(
    sidebar.getByText(/Level 3|0 \/ 100 XP|0 contacts|120 XP/)
  ).toHaveCount(0);

  api.releaseStats();
  await expect(
    sidebar.getByText("Momentum unavailable.", { exact: true })
  ).toBeVisible();
  await expect(sidebar.getByText("Social Novice")).toHaveCount(0);
  await expect(
    sidebar.getByText(/Level 3|0 \/ 100 XP|0 contacts|120 XP/)
  ).toHaveCount(0);
});

test("recovers a reminder quest after its committed PUT response is lost", async ({
  page,
}) => {
  const api = await installApi(page, {
    loseFirstReminderQuestResponse: true,
  });
  await page.goto("/dashboard/today");

  const reminderQuest = page
    .locator("li")
    .filter({ hasText: "Complete the synthetic reminder" });
  await reminderQuest.getByRole("button", { name: "Complete quest" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Complete the synthetic reminder",
  });
  await dialog.getByRole("button", { name: "Complete and verify" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(api.reminderQuestCompletionCalls).toBe(1);
  expect(api.questBodies).toHaveLength(0);

  await dialog.getByRole("button", { name: "Complete and verify" }).click();
  await expect.poll(() => api.reminderQuestCompletionCalls).toBe(1);
  await expect
    .poll(() => api.questBodies)
    .toContainEqual({ reminderId: "quest-reminder-target" });
});

test("keeps each cockpit dialog open for Escape and backdrop while busy", async ({
  page,
}) => {
  const api = await installApi(page, {
    holdFeedback: true,
    holdQuestComplete: true,
    holdReminderCreate: true,
  });
  await page.goto("/dashboard/today");

  const event = page
    .locator("li")
    .filter({ hasText: "Synthetic learning meetup" });
  const dismissTrigger = event.getByRole("button", { name: "Dismiss" });
  await dismissTrigger.click();
  const dismissDialog = page.getByRole("dialog", {
    name: "Dismiss suggestion",
  });
  await dismissDialog.getByRole("button", { name: "Dismiss" }).click();
  await expect(
    dismissDialog.getByRole("button", { name: "Saving..." })
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await dismissDialog.locator("..").click({ position: { x: 1, y: 1 } });
  await expect(dismissDialog).toBeVisible();
  api.releaseFeedback();
  await expect(dismissDialog).toBeHidden();

  const person = page
    .locator("li")
    .filter({ hasText: "Synthetic Person" })
    .first();
  const reminderTrigger = person.getByRole("button", {
    name: "Create reminder",
  });
  await reminderTrigger.click();
  const reminderDialog = page.getByRole("dialog", { name: "Create reminder" });
  await reminderDialog.getByRole("button", { name: "Create reminder" }).click();
  await expect(
    reminderDialog.getByRole("button", { name: "Saving..." })
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await reminderDialog.locator("..").click({ position: { x: 1, y: 1 } });
  await expect(reminderDialog).toBeVisible();
  api.releaseReminderCreate();
  await expect(reminderDialog).toBeHidden();

  const quest = page
    .locator("li")
    .filter({ hasText: "Complete the synthetic reminder" });
  const questTrigger = quest.getByRole("button", { name: "Complete quest" });
  await questTrigger.click();
  const questDialog = page.getByRole("dialog", {
    name: "Complete the synthetic reminder",
  });
  await questDialog
    .getByRole("button", { name: "Complete and verify" })
    .click();
  await expect(
    questDialog.getByRole("button", { name: "Verifying..." })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quest verified" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await questDialog.locator("..").click({ position: { x: 1, y: 1 } });
  await expect(questDialog).toBeVisible();
  api.releaseQuestComplete();
  await expect(questDialog).toBeHidden();
});

test("fits and navigates at Pixel 412x915", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await installApi(page);
  await page.goto("/dashboard/today");
  await expect(
    page.getByRole("navigation", { name: "Mobile dashboard" })
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(412);
  await page.screenshot({
    path: testInfo.outputPath("daily-cockpit-pixel-412x915.png"),
    fullPage: true,
  });
});
