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
      evidence: [],
      state: "pending",
    },
  ],
  dates: [
    {
      itemId: "date-item",
      rank: 1,
      contact: { id: "contact-date", name: "Synthetic Friend" },
      type: "celebration",
      title: "Synthetic celebration",
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
  questBodies: Array<Record<string, unknown>>;
  completedReminders: string[];
  decisions: string[];
  failFirstKeep: boolean;
  reminderBodies: Array<Record<string, unknown>>;
  generateCalls: number;
}

async function installApi(
  page: Page,
  options: { briefReady?: boolean; failApprovals?: boolean } = {}
): Promise<ApiState> {
  const state: ApiState = {
    feedback: [],
    interactionBodies: [],
    questBodies: [],
    completedReminders: [],
    decisions: [],
    failFirstKeep: true,
    reminderBodies: [],
    generateCalls: 0,
  };
  let briefReady = options.briefReady ?? true;
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
    if (url.pathname === "/api/gamification/stats")
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
    if (url.pathname === "/api/gamification/streak")
      return json(route, {
        streakDays: 4,
        lastActiveAt: now,
        checkedInToday: true,
        checkedInYesterday: true,
        streakAtRisk: false,
      });
    if (url.pathname === "/api/briefs/today")
      return briefReady
        ? json(route, brief)
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
      return json(route, brief);
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
    if (url.pathname === "/api/agent-proposals/history")
      return options.failApprovals
        ? json(route, { message: "Synthetic approval failure" }, 503)
        : json(route, {
            proposals:
              url.searchParams.get("status") &&
              url.searchParams.get("status") !== "all"
                ? proposals.filter(
                    (proposal) =>
                      proposal.status === url.searchParams.get("status")
                  )
                : proposals,
            total: proposals.length,
            offset: 0,
            limit: 20,
          });
    if (url.pathname === "/api/reminders" && method === "POST") {
      state.reminderBodies.push(
        request.postDataJSON() as Record<string, unknown>
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
      if (entry.body.action === "accept" && state.failFirstKeep) {
        state.failFirstKeep = false;
        return json(route, { message: "Synthetic retry" }, 503);
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
          status: "pending",
        },
      });
    if (
      url.pathname === "/api/contacts/contact-synthetic/interactions" &&
      method === "POST"
    ) {
      state.interactionBodies.push(
        request.postDataJSON() as Record<string, unknown>
      );
      return json(route, { interaction: { id: "interaction-evidence" } });
    }
    const questComplete = url.pathname.match(
      /^\/api\/briefs\/quests\/([^/]+)\/complete$/
    );
    if (questComplete && method === "POST") {
      state.questBodies.push(request.postDataJSON() as Record<string, unknown>);
      return json(route, {
        feedbackId: "quest-feedback",
        questId: questComplete[1],
        status: "completed",
        completedAt: now,
        xpAwarded: 20,
      });
    }
    const reminderComplete = url.pathname.match(
      /^\/api\/reminders\/([^/]+)\/complete$/
    );
    if (reminderComplete && method === "PUT") {
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
  const api = await installApi(page);
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
  expect(api.feedback.at(-1)?.body).toMatchObject({
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

  await page.getByRole("link", { name: /pending approvals/ }).click();
  await expect(page).toHaveURL(/\/dashboard\/approvals\?status=pending$/);
  const message = page.locator("li").filter({ hasText: "Synthetic draft" });
  await message.getByRole("button", { name: "Approve" }).click();
  await expect.poll(() => api.decisions).toContain("proposal-approve:approve");
  await page.getByRole("link", { name: "all" }).click();
  await expect(page.getByText(/Approval granted/)).toBeVisible();
  await expect(page.getByText("Sent")).toHaveCount(0);
  const invitation = page
    .locator("li")
    .filter({ hasText: "Synthetic invitation" });
  await invitation.getByRole("button", { name: "Reject" }).click();
  await expect.poll(() => api.decisions).toContain("proposal-reject:reject");
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
  await expect(page.getByRole("link", { name: "Synthetic Person" })).toBeVisible();
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
