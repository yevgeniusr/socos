import { expect, test, type Page, type Route } from "@playwright/test";

const ISO_NOW = "2026-07-16T12:00:00.000Z";

function listContact(id: string, firstName: string, lastName: string) {
  return {
    id,
    firstName,
    lastName,
    nickname: null,
    photo: null,
    company: "Synthetic Labs",
    jobTitle: "Community Builder",
    relationshipScore: 82,
    importance: 4,
    preferredCadenceDays: 30,
    labels: ["AI Founders"],
    tags: ["mentor"],
    groups: ["Mentors"],
    lastContactedAt: "2026-07-10T09:00:00.000Z",
    nextReminderAt: "2026-07-20T09:00:00.000Z",
    createdAt: ISO_NOW,
    updatedAt: ISO_NOW,
    _count: { interactions: 1, reminders: 1 },
  };
}

const mentorListContact = listContact(
  "synthetic-mentor",
  "Synthetic",
  "Mentor"
);

const contactDetail = {
  ...mentorListContact,
  middleName: null,
  bio: "Synthetic relationship memory for browser verification.",
  birthday: "1990-01-12T00:00:00.000Z",
  anniversary: "2020-06-08T00:00:00.000Z",
  socialLinks: { website: "https://example.test/synthetic-mentor" },
  firstMetDate: "2024-03-02T00:00:00.000Z",
  firstMetContext: "Met at a synthetic community workshop.",
  sourceSystem: "synthetic-import",
  importedAt: "2026-07-01T00:00:00.000Z",
  contactFields: [
    {
      id: "synthetic-field-email",
      contactId: "synthetic-mentor",
      type: "email",
      value: "mentor@example.test",
      label: "work",
      isPrimary: true,
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    },
  ],
  interactions: [
    {
      id: "synthetic-interaction-existing",
      contactId: "synthetic-mentor",
      ownerId: "synthetic-owner",
      type: "meeting",
      title: "Synthetic planning session",
      content: "Discussed a synthetic mentoring plan.",
      summary: null,
      occurredAt: "2026-07-10T09:00:00.000Z",
      duration: 45,
      location: null,
      xpEarned: 10,
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    },
  ],
  reminders: [
    {
      id: "synthetic-reminder-existing",
      contactId: "synthetic-mentor",
      ownerId: "synthetic-owner",
      type: "followup",
      title: "Synthetic follow-up",
      description: "Send the synthetic notes.",
      scheduledAt: "2026-07-20T09:00:00.000Z",
      completedAt: null,
      repeatInterval: null,
      isRecurring: false,
      status: "pending",
      createdAt: ISO_NOW,
      updatedAt: ISO_NOW,
    },
  ],
  _count: { interactions: 1, reminders: 1, tasks: 0, gifts: 0 },
};

interface SyntheticApiState {
  listRequests: URL[];
  updatePayloads: Array<Record<string, unknown>>;
  interactionPayloads: Array<Record<string, unknown>>;
  reminderPayloads: Array<Record<string, unknown>>;
  completedReminderIds: string[];
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installSyntheticApi(page: Page): Promise<SyntheticApiState> {
  const state: SyntheticApiState = {
    listRequests: [],
    updatePayloads: [],
    interactionPayloads: [],
    reminderPayloads: [],
    completedReminderIds: [],
  };

  await page.addInitScript(() => {
    localStorage.setItem("socos_token", "synthetic-token");
    localStorage.setItem(
      "socos_user",
      JSON.stringify({
        id: "synthetic-owner",
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
      return json(route, {
        user: {
          id: "synthetic-owner",
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
    if (url.pathname === "/api/reminders/upcoming") {
      return json(route, {
        reminders: [{ id: "synthetic-reminder-existing" }],
        stats: { today: 0, thisWeek: 1, overdue: 0 },
      });
    }
    if (url.pathname === "/api/contacts/labels") {
      return json(route, ["AI Founders", "Friends"]);
    }
    if (url.pathname === "/api/contacts/tags") {
      return json(route, ["mentor", "learning"]);
    }
    if (url.pathname === "/api/contacts/groups") {
      return json(route, ["Mentors", "Communities"]);
    }
    if (url.pathname === "/api/contacts" && method === "GET") {
      state.listRequests.push(new URL(url));
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const filtered =
        url.searchParams.get("search") === "mentor" ||
        url.searchParams.get("label") === "AI Founders";
      if (filtered) {
        return json(route, {
          contacts: [mentorListContact],
          total: 1,
          offset: 0,
          limit: 25,
        });
      }
      const contacts = Array.from({ length: 25 }, (_, index) => {
        const position = offset + index + 1;
        return position === 26
          ? listContact("synthetic-page-two", "Synthetic", "Page Two")
          : listContact(
              `synthetic-contact-${position}`,
              "Synthetic",
              `Contact ${position}`
            );
      });
      return json(route, { contacts, total: 106, offset, limit: 25 });
    }
    if (url.pathname === "/api/contacts/synthetic-mentor" && method === "GET") {
      return json(route, contactDetail);
    }
    if (url.pathname === "/api/contacts/synthetic-mentor" && method === "PUT") {
      state.updatePayloads.push(
        request.postDataJSON() as Record<string, unknown>
      );
      return json(route, contactDetail);
    }
    if (url.pathname === "/api/interactions" && method === "POST") {
      state.interactionPayloads.push(
        request.postDataJSON() as Record<string, unknown>
      );
      return json(route, { interaction: { id: "synthetic-interaction-new" } });
    }
    if (url.pathname === "/api/reminders" && method === "POST") {
      state.reminderPayloads.push(
        request.postDataJSON() as Record<string, unknown>
      );
      return json(route, { id: "synthetic-reminder-new" });
    }
    const completion = url.pathname.match(
      /^\/api\/reminders\/([^/]+)\/complete$/
    );
    if (completion && method === "PUT") {
      state.completedReminderIds.push(decodeURIComponent(completion[1]));
      return json(route, {
        ...contactDetail.reminders[0],
        status: "completed",
      });
    }

    return json(route, { message: `Unhandled synthetic route ${method}` }, 404);
  });

  return state;
}

test.describe("personal Contacts workspace", () => {
  test("reaches all contacts and performs profile actions with exact API contracts", async ({
    page,
  }) => {
    const api = await installSyntheticApi(page);

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard\/contacts$/);
    await expect(page.getByText("Showing 1-25 of 106")).toBeVisible();
    await expect.poll(() => api.listRequests.length).toBeGreaterThan(0);
    expect(api.listRequests[0].searchParams.get("limit")).toBe("25");
    expect(api.listRequests[0].searchParams.get("offset")).toBe("0");

    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText("Showing 26-50 of 106")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Open contact profile for Synthetic Page Two",
      })
    ).toBeVisible();
    await expect
      .poll(() =>
        api.listRequests.some((url) => url.searchParams.get("offset") === "25")
      )
      .toBe(true);

    await page
      .getByRole("searchbox", { name: "Search contacts" })
      .fill("mentor");
    await expect
      .poll(() =>
        api.listRequests.some(
          (url) =>
            url.searchParams.get("search") === "mentor" &&
            url.searchParams.get("offset") === "0"
        )
      )
      .toBe(true);
    await expect(page.getByText("Showing 1-1 of 1")).toBeVisible();

    await page
      .getByRole("combobox", { name: "Filter by label" })
      .selectOption("AI Founders");
    await expect
      .poll(() =>
        api.listRequests.some(
          (url) =>
            url.searchParams.get("label") === "AI Founders" &&
            url.searchParams.get("offset") === "0"
        )
      )
      .toBe(true);

    const mentorRow = page.getByRole("button", {
      name: "Open contact profile for Synthetic Mentor",
    });
    await mentorRow.focus();
    await mentorRow.press("Enter");
    await expect(page).toHaveURL(
      /\/dashboard\/contacts\?contact=synthetic-mentor$/
    );

    const profile = page.getByRole("dialog", { name: "Contact profile" });
    await expect(profile).toBeVisible();
    await expect(profile.getByText(contactDetail.bio)).toBeVisible();
    await expect(profile.getByText("mentor@example.test")).toBeVisible();
    await expect(
      profile.getByRole("heading", { name: "Important dates" })
    ).toBeVisible();
    await expect(profile.getByText("Synthetic planning session")).toBeVisible();
    await expect(profile.getByText("Synthetic follow-up")).toBeVisible();

    await profile.getByRole("button", { name: "Edit contact" }).click();
    await profile
      .getByRole("textbox", { name: "Value" })
      .fill("updated@example.test");
    await profile.getByRole("button", { name: "Save changes" }).click();
    await expect.poll(() => api.updatePayloads.length).toBe(1);
    expect(api.updatePayloads[0]).toMatchObject({
      firstName: "Synthetic",
      contactFields: [
        {
          type: "email",
          value: "updated@example.test",
          label: "work",
          isPrimary: true,
        },
      ],
    });
    expect(api.updatePayloads[0]).not.toHaveProperty("relationshipScore");
    expect(api.updatePayloads[0]).not.toHaveProperty("ownerId");
    expect(api.updatePayloads[0]).not.toHaveProperty("sourceId");

    await profile.getByRole("button", { name: "Call" }).click();
    const interactionForm = profile
      .getByRole("heading", {
        name: "Log interaction",
      })
      .locator("..")
      .locator("..");
    await interactionForm
      .getByRole("textbox", { name: "Title" })
      .fill("Synthetic call");
    await interactionForm
      .getByRole("textbox", { name: "Notes" })
      .fill("Synthetic browser notes");
    await interactionForm
      .getByRole("button", { name: "Log interaction" })
      .click();
    await expect.poll(() => api.interactionPayloads.length).toBe(1);
    expect(api.interactionPayloads[0]).toMatchObject({
      contactId: "synthetic-mentor",
      type: "call",
      title: "Synthetic call",
      content: "Synthetic browser notes",
    });
    expect(api.interactionPayloads[0].occurredAt).toEqual(expect.any(String));
    await profile
      .getByRole("button", { name: "Close interaction form" })
      .click();

    await profile.getByRole("button", { name: "Remind", exact: true }).click();
    const reminderForm = profile
      .getByRole("heading", {
        name: "Schedule reminder",
      })
      .locator("..")
      .locator("..");
    await reminderForm
      .getByRole("textbox", { name: "Title" })
      .fill("Synthetic reminder");
    await reminderForm
      .getByRole("textbox", { name: "Description" })
      .fill("Synthetic reminder details");
    await reminderForm.getByRole("button", { name: "Create reminder" }).click();
    await expect.poll(() => api.reminderPayloads.length).toBe(1);
    expect(api.reminderPayloads[0]).toMatchObject({
      contactId: "synthetic-mentor",
      type: "followup",
      title: "Synthetic reminder",
      description: "Synthetic reminder details",
    });
    expect(api.reminderPayloads[0].scheduledAt).toEqual(expect.any(String));

    await profile
      .getByRole("button", { name: "Complete reminder Synthetic follow-up" })
      .click();
    await expect
      .poll(() => api.completedReminderIds)
      .toEqual(["synthetic-reminder-existing"]);
  });

  test("contains modal focus and fits the Pixel viewport", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await installSyntheticApi(page);
    await page.goto("/dashboard/contacts");
    await expect(page.getByText("Showing 1-25 of 106")).toBeVisible();

    await page.getByRole("button", { name: "Add contact" }).click();
    const createDialog = page.getByRole("dialog", { name: "Add contact" });
    const closeCreate = createDialog.getByRole("button", {
      name: "Close add contact dialog",
    });
    const createContact = createDialog.getByRole("button", {
      name: "Create contact",
    });
    await closeCreate.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(createContact).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeCreate).toBeFocused();
    await closeCreate.click();

    await page
      .getByRole("searchbox", { name: "Search contacts" })
      .fill("mentor");
    const mentorRow = page.getByRole("button", {
      name: "Open contact profile for Synthetic Mentor",
    });
    await expect(mentorRow).toBeVisible();
    await mentorRow.click();

    const profile = page.getByRole("dialog", { name: "Contact profile" });
    await expect(profile).toBeVisible();
    await expect(
      profile.getByRole("button", { name: "Close profile" })
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("contacts-pixel-412x915.png"),
      fullPage: true,
    });
  });
});
