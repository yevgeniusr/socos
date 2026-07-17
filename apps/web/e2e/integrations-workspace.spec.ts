import { expect, test, type Page, type Route } from "@playwright/test";

const ISO_NOW = "2026-07-17T08:00:00.000Z";
const FEED_URL = "https://events.example.test/dubai-ai.ics";
const FIRST_PASSWORD = "synthetic-password-once";
const ROTATED_PASSWORD = "synthetic-password-rotated-once";
const browserErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:")
    ) {
      errors.push(message.text());
    }
  });
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

const calendarConnection = {
  id: "calendar-connection",
  status: "active",
  grantedScopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  lastSyncedAt: ISO_NOW,
  errorCode: null,
  createdAt: ISO_NOW,
  updatedAt: ISO_NOW,
};

const calendarSources = [
  {
    id: "calendar-source-primary",
    name: "Synthetic primary calendar",
    timeZone: "Asia/Dubai",
    selected: true,
    isPrimary: true,
    fullSyncRequired: false,
    lastSyncedAt: ISO_NOW,
    errorCode: null,
  },
];

const locationDevice = {
  id: "pixel-device",
  name: "Synthetic Pixel",
  externalDeviceId: "synthetic-pixel-9",
  status: "active",
  rawRetentionDays: 45,
  derivedRetentionDays: 365,
  lastSeenAt: ISO_NOW,
  createdAt: ISO_NOW,
  updatedAt: ISO_NOW,
};

const locationContext = {
  source: "visit" as const,
  city: "Dubai",
  countryCode: "AE",
  timeZone: "Asia/Dubai",
  distanceCapability: true,
  lastSeenAt: ISO_NOW,
};

const eventSource = {
  id: "event-source",
  name: "Synthetic Dubai AI",
  provider: "ics",
  allowedHost: "events.example.test",
  city: "Dubai",
  countryCode: "AE",
  socialWeight: 7,
  status: "active",
  pollIntervalMinutes: 60,
  nextPollAt: ISO_NOW,
  lastPolledAt: null,
  errorCode: null,
  createdAt: ISO_NOW,
  updatedAt: ISO_NOW,
};

const eventPreference = {
  id: "event-preference",
  interestTags: ["ai", "arts", "community"],
  maxDistanceKm: 25,
  travelSpeedKph: 35,
  travelBufferMinutes: 20,
  createdAt: ISO_NOW,
  updatedAt: ISO_NOW,
};

type SyntheticOptions = {
  disabled?: boolean;
  calendarFailures?: number;
  calendarPatchFailures?: number;
  emptyPixel?: boolean;
  emptyEvents?: boolean;
  holdFirstCalendarPatchFailure?: boolean;
  failLocationRotation?: boolean;
  holdLocationRotation?: boolean;
  pixelAwaitingFirstSample?: boolean;
  eventErrorOnly?: boolean;
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function noContent(route: Route) {
  await route.fulfill({ status: 204, body: "" });
}

async function seedAuthentication(page: Page) {
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
}

async function installSyntheticApi(page: Page, options: SyntheticOptions = {}) {
  await seedAuthentication(page);
  const state = {
    calendarFailuresRemaining: options.calendarFailures ?? 0,
    calendarConnection: {
      ...calendarConnection,
    } as Omit<typeof calendarConnection, "status" | "errorCode"> & {
      status: string;
      errorCode: string | null;
    },
    calendarConnectPayloads: [] as unknown[],
    calendarSelectionPayloads: [] as unknown[],
    calendarPatchAttempts: 0,
    calendarPatchFailuresRemaining: options.calendarPatchFailures ?? 0,
    releaseCalendarPatchFailure: undefined as (() => void) | undefined,
    calendarDisconnects: 0,
    locationCreatePayloads: [] as unknown[],
    locationRotations: 0,
    releaseLocationRotation: undefined as (() => void) | undefined,
    locationRevocations: 0,
    eventCreatePayloads: [] as unknown[],
    eventUpdatePayloads: [] as unknown[],
    eventRemovals: 0,
    preferencePayloads: [] as unknown[],
    createdDevice: options.emptyPixel
      ? null
      : options.pixelAwaitingFirstSample
        ? { ...locationDevice, lastSeenAt: null }
        : locationDevice,
    createdEventSource: options.emptyEvents
      ? null
      : options.eventErrorOnly
        ? {
            ...eventSource,
            status: "error",
            errorCode: "upstream_timeout",
            lastPolledAt: "2026-07-17T07:00:00.000Z",
            nextPollAt: "2026-07-17T09:00:00.000Z",
          }
        : eventSource,
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());

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
          levelName: "Connector",
          totalContacts: 12,
          xpProgress: 20,
          xpNeeded: 100,
        },
      });
    }
    if (url.pathname === "/api/reminders/upcoming") {
      return json(route, {
        reminders: [],
        stats: { today: 0, thisWeek: 0, overdue: 0 },
      });
    }

    const integrationPaths = [
      "/api/integrations/google-calendar",
      "/api/integrations/google-calendar/sources",
      "/api/location-devices",
      "/api/location-context/current",
      "/api/event-sources",
      "/api/event-preferences",
    ];
    if (options.disabled && integrationPaths.includes(url.pathname)) {
      return json(
        route,
        {
          code: "integration_not_configured",
          message: "Integration is not configured",
        },
        503
      );
    }

    if (
      url.pathname === "/api/integrations/google-calendar" &&
      method === "GET"
    ) {
      if (state.calendarFailuresRemaining > 0) {
        state.calendarFailuresRemaining -= 1;
        return json(route, { message: "Synthetic Calendar failure" }, 500);
      }
      return json(route, state.calendarConnection);
    }
    if (
      url.pathname === "/api/integrations/google-calendar/sources" &&
      method === "GET"
    ) {
      return json(route, calendarSources);
    }
    if (
      url.pathname === "/api/integrations/google-calendar/connect" &&
      method === "POST"
    ) {
      state.calendarConnectPayloads.push(request.postDataJSON());
      return json(route, {
        authorizationUrl: "/dashboard/integrations?synthetic-oauth=google",
      });
    }
    if (
      url.pathname ===
        "/api/integrations/google-calendar/calendars/calendar-source-primary" &&
      method === "PATCH"
    ) {
      state.calendarSelectionPayloads.push(request.postDataJSON());
      state.calendarPatchAttempts += 1;
      if (
        options.holdFirstCalendarPatchFailure &&
        state.calendarPatchAttempts === 1
      ) {
        await new Promise<void>((resolve) => {
          state.releaseCalendarPatchFailure = resolve;
        });
        return json(route, { message: "Synthetic selection failure" }, 500);
      }
      if (state.calendarPatchFailuresRemaining > 0) {
        state.calendarPatchFailuresRemaining -= 1;
        return json(route, { message: "Synthetic selection failure" }, 500);
      }
      return noContent(route);
    }
    if (
      url.pathname === "/api/integrations/google-calendar" &&
      method === "DELETE"
    ) {
      state.calendarDisconnects += 1;
      return noContent(route);
    }

    if (url.pathname === "/api/location-devices" && method === "GET") {
      return json(route, state.createdDevice ? [state.createdDevice] : []);
    }
    if (url.pathname === "/api/location-context/current" && method === "GET") {
      return json(route, locationContext);
    }
    if (url.pathname === "/api/location-devices" && method === "POST") {
      state.locationCreatePayloads.push(request.postDataJSON());
      state.createdDevice = locationDevice;
      return json(route, {
        device: locationDevice,
        credentials: {
          username: "synthetic-pixel-user",
          password: FIRST_PASSWORD,
        },
      });
    }
    if (
      url.pathname === "/api/location-devices/pixel-device/rotate" &&
      method === "POST"
    ) {
      state.locationRotations += 1;
      if (options.holdLocationRotation) {
        await new Promise<void>((resolve) => {
          state.releaseLocationRotation = resolve;
        });
      }
      if (options.failLocationRotation) {
        return json(route, { message: "Synthetic rotation failure" }, 500);
      }
      return json(route, {
        device: {
          id: locationDevice.id,
          status: locationDevice.status,
          rawRetentionDays: locationDevice.rawRetentionDays,
          derivedRetentionDays: locationDevice.derivedRetentionDays,
          lastSeenAt: locationDevice.lastSeenAt,
          createdAt: locationDevice.createdAt,
          updatedAt: locationDevice.updatedAt,
        },
        credentials: {
          username: "synthetic-pixel-user-rotated",
          password: ROTATED_PASSWORD,
        },
      });
    }
    if (
      url.pathname === "/api/location-devices/pixel-device" &&
      method === "DELETE"
    ) {
      state.locationRevocations += 1;
      state.createdDevice = { ...locationDevice, status: "revoked" };
      return noContent(route);
    }

    if (url.pathname === "/api/event-sources" && method === "GET") {
      return json(
        route,
        state.createdEventSource ? [state.createdEventSource] : []
      );
    }
    if (url.pathname === "/api/event-preferences" && method === "GET") {
      return json(route, eventPreference);
    }
    if (url.pathname === "/api/event-sources" && method === "POST") {
      state.eventCreatePayloads.push(request.postDataJSON());
      state.createdEventSource = eventSource;
      return json(route, eventSource);
    }
    if (
      url.pathname === "/api/event-sources/event-source" &&
      method === "PATCH"
    ) {
      const payload = request.postDataJSON();
      state.eventUpdatePayloads.push(payload);
      state.createdEventSource = {
        ...eventSource,
        status: (payload as { status?: string }).status ?? eventSource.status,
      };
      return json(route, state.createdEventSource);
    }
    if (
      url.pathname === "/api/event-sources/event-source" &&
      method === "DELETE"
    ) {
      state.eventRemovals += 1;
      state.createdEventSource = null;
      return noContent(route);
    }
    if (url.pathname === "/api/event-preferences" && method === "PUT") {
      state.preferencePayloads.push(request.postDataJSON());
      return json(route, eventPreference);
    }

    return json(route, { message: `Unhandled synthetic route ${method}` }, 404);
  });

  return state;
}

test.describe("authenticated Integrations workspace", () => {
  test("maps exact disabled gates without generic errors", async ({ page }) => {
    await installSyntheticApi(page, { disabled: true });
    await page.goto("/dashboard/integrations");

    await expect(
      page.getByRole("heading", { name: "Integrations" })
    ).toBeVisible();
    await expect(page.getByText("Not enabled", { exact: true })).toHaveCount(3);
    await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(
      0
    );
    await expect(page.getByText(/integration is not configured/i)).toHaveCount(
      0
    );
  });

  test("connects, selects, receives callback, and truthfully disconnects Calendar", async ({
    page,
  }) => {
    const api = await installSyntheticApi(page);
    await page.goto("/dashboard/integrations");

    const calendar = page.getByRole("region", { name: "Google Calendar" });
    await expect(
      calendar.getByText("Connected", { exact: true })
    ).toBeVisible();

    const calendarCheckbox = calendar.getByRole("checkbox", {
      name: "Use Synthetic primary calendar",
    });
    await calendarCheckbox.uncheck();
    await expect
      .poll(() => api.calendarSelectionPayloads)
      .toEqual([{ selected: false }]);

    await calendar
      .getByRole("button", { name: "Reconnect Google Calendar" })
      .click();
    await expect.poll(() => api.calendarConnectPayloads).toEqual([{}]);
    await expect(page).toHaveURL(/synthetic-oauth=google/);

    await page.goto("/dashboard/integrations?calendar=connected");
    await expect(
      page.getByRole("status").filter({ hasText: "Google Calendar connected" })
    ).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard\/integrations$/);

    const disconnect = calendar.getByRole("button", {
      name: "Disconnect Google Calendar",
    });
    await disconnect.click();
    const dialog = page.getByRole("dialog", {
      name: "Disconnect Google Calendar",
    });
    await expect(dialog).toContainText(
      "Stops new Calendar sync and starts cleanup of the synced Calendar connection and Calendar-derived context. Provider watch cleanup is best-effort, so cleanup may remain pending. This is not the full personal-context erasure control."
    );
    await expect(api.calendarDisconnects).toBe(0);
    await dialog.getByRole("button", { name: "Disconnect" }).click();
    await expect.poll(() => api.calendarDisconnects).toBe(1);
    const disconnectReceipt = calendar
      .getByRole("status")
      .filter({ hasText: "provider watch cleanup may remain pending" });
    await expect(disconnectReceipt).toBeVisible();
    await expect(disconnectReceipt).toBeFocused();
    await expect(disconnectReceipt).not.toContainText(
      "removed the synced Calendar connection"
    );
  });

  test("shows Pixel credentials once and confirms rotation and revocation", async ({
    page,
  }) => {
    const api = await installSyntheticApi(page, { emptyPixel: true });
    await page.goto("/dashboard/integrations");

    const pixel = page.getByRole("region", { name: "Pixel location" });
    await pixel
      .getByRole("textbox", { name: "Device name" })
      .fill("Synthetic Pixel");
    await pixel
      .getByRole("textbox", { name: "External device ID" })
      .fill("synthetic-pixel-9");
    await pixel
      .getByRole("spinbutton", { name: "Raw retention days" })
      .fill("45");
    await pixel
      .getByRole("spinbutton", { name: "Derived retention days" })
      .fill("365");
    await pixel.getByRole("button", { name: "Create Pixel device" }).click();

    await expect
      .poll(() => api.locationCreatePayloads)
      .toEqual([
        {
          name: "Synthetic Pixel",
          externalDeviceId: "synthetic-pixel-9",
          rawRetentionDays: 45,
          derivedRetentionDays: 365,
        },
      ]);
    const credentials = page.getByRole("dialog", {
      name: "One-time Pixel credentials",
    });
    await expect(credentials).toContainText("/api/location/owntracks");
    await expect(credentials).toContainText("synthetic-pixel-user");
    await expect(credentials).toContainText(FIRST_PASSWORD);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            `${localStorage.getItem("socos_token")}\n${localStorage.getItem("socos_user")}`
        )
      )
      .not.toContain(FIRST_PASSWORD);
    await page.reload();
    await expect(page.getByText(FIRST_PASSWORD)).toHaveCount(0);
    await expect(credentials).toHaveCount(0);

    const rotateButton = pixel.getByRole("button", {
      name: "Rotate credentials for Synthetic Pixel",
    });
    await rotateButton.click();
    const rotate = page.getByRole("dialog", {
      name: "Rotate Pixel credentials",
    });
    await expect(rotate).toContainText(
      "Existing credentials will stop working"
    );
    await rotate.getByRole("button", { name: "Rotate credentials" }).click();
    await expect.poll(() => api.locationRotations).toBe(1);
    await expect(credentials).toContainText("synthetic-pixel-user-rotated");
    await expect(credentials).toContainText(ROTATED_PASSWORD);
    await expect(credentials).not.toContainText(FIRST_PASSWORD);
    await credentials
      .getByRole("button", { name: "Close credentials" })
      .click();
    await expect(page.getByText(ROTATED_PASSWORD)).toHaveCount(0);
    await expect(rotateButton).toBeFocused();

    await pixel.getByRole("button", { name: "Revoke Synthetic Pixel" }).click();
    const revoke = page.getByRole("dialog", { name: "Revoke Pixel device" });
    await expect(revoke).toContainText(
      "Stops new location ingest. Existing location history is not deleted."
    );
    await revoke.getByRole("button", { name: "Revoke device" }).click();
    await expect.poll(() => api.locationRevocations).toBe(1);
    await expect(pixel.getByText("Revoked", { exact: true })).toBeVisible();
    await expect(pixel).not.toContainText(/history (was|has been) deleted/i);
    await expect(
      pixel.getByRole("status").filter({ hasText: "existing history remains" })
    ).toBeFocused();
  });

  test("creates and manages event sources and balanced preferences without revealing feeds", async ({
    page,
  }) => {
    const api = await installSyntheticApi(page, { emptyEvents: true });
    await page.goto("/dashboard/integrations");

    const events = page.getByRole("region", { name: "Event discovery" });
    await events
      .getByRole("textbox", { name: "Source name" })
      .fill("Synthetic Dubai AI");
    await events.getByRole("textbox", { name: "ICS feed URL" }).fill(FEED_URL);
    await events.getByRole("textbox", { name: "Source city" }).fill("Dubai");
    await events
      .getByRole("textbox", { name: "Source country code" })
      .fill("AE");
    await events.getByRole("spinbutton", { name: "Social weight" }).fill("7");
    await events
      .getByRole("spinbutton", { name: "Poll interval minutes" })
      .fill("60");
    await events.getByRole("button", { name: "Add event source" }).click();

    await expect
      .poll(() => api.eventCreatePayloads)
      .toEqual([
        {
          name: "Synthetic Dubai AI",
          feedUrl: FEED_URL,
          city: "Dubai",
          countryCode: "AE",
          socialWeight: 7,
          pollIntervalMinutes: 60,
        },
      ]);
    await expect(
      events.getByText("events.example.test", { exact: true })
    ).toBeVisible();
    await expect(page.getByText(FEED_URL, { exact: true })).toHaveCount(0);
    await expect(
      events.getByRole("textbox", { name: "ICS feed URL" })
    ).toHaveValue("");

    await events
      .getByRole("textbox", { name: "Interest tags" })
      .fill("ai, arts, community");
    await events
      .getByRole("spinbutton", { name: "Maximum distance km" })
      .fill("25");
    await events
      .getByRole("spinbutton", { name: "Travel speed kph" })
      .fill("35");
    await events
      .getByRole("spinbutton", { name: "Travel buffer minutes" })
      .fill("20");
    await events
      .getByRole("button", { name: "Save event preferences" })
      .click();
    await expect
      .poll(() => api.preferencePayloads)
      .toEqual([
        {
          interestTags: ["ai", "arts", "community"],
          maxDistanceKm: 25,
          travelSpeedKph: 35,
          travelBufferMinutes: 20,
        },
      ]);

    await events
      .getByRole("button", { name: "Disable Synthetic Dubai AI" })
      .click();
    const disable = page.getByRole("dialog", { name: "Disable event source" });
    await disable.getByRole("button", { name: "Disable source" }).click();
    await expect
      .poll(() => api.eventUpdatePayloads)
      .toEqual([{ status: "disabled" }]);
    await events
      .getByRole("button", { name: "Enable Synthetic Dubai AI" })
      .click();
    await expect
      .poll(() => api.eventUpdatePayloads)
      .toEqual([{ status: "disabled" }, { status: "active" }]);

    await events
      .getByRole("button", { name: "Remove Synthetic Dubai AI" })
      .click();
    const remove = page.getByRole("dialog", { name: "Remove event source" });
    await expect(remove).toContainText(
      "Deletes this source, its discovered events, and related Daily Brief state. Unrelated personal data remains."
    );
    await remove.getByRole("button", { name: "Remove source" }).click();
    await expect.poll(() => api.eventRemovals).toBe(1);
    await expect(
      events
        .getByRole("status")
        .filter({ hasText: "related Daily Brief state were deleted" })
    ).toBeFocused();
  });

  test("restores focus after a failed Pixel credential rotation", async ({
    page,
  }) => {
    const api = await installSyntheticApi(page, {
      failLocationRotation: true,
      holdLocationRotation: true,
    });
    await page.goto("/dashboard/integrations");
    const pixel = page.getByRole("region", { name: "Pixel location" });
    const rotateButton = pixel.getByRole("button", {
      name: "Rotate credentials for Synthetic Pixel",
    });

    await rotateButton.click();
    await page
      .getByRole("dialog", { name: "Rotate Pixel credentials" })
      .getByRole("button", { name: "Rotate credentials" })
      .click();

    const busyDialog = page.getByRole("dialog", {
      name: "Rotate Pixel credentials",
    });
    await expect.poll(() => api.releaseLocationRotation).toBeDefined();
    await page.keyboard.press("Tab");
    const focusStayedInDialog = await busyDialog.evaluate(
      (dialog) => dialog === document.activeElement
    );
    api.releaseLocationRotation?.();
    expect(focusStayedInDialog).toBe(true);

    await expect.poll(() => api.locationRotations).toBe(1);
    await expect(
      pixel.getByRole("alert").filter({ hasText: "Synthetic rotation failure" })
    ).toBeVisible();
    await expect(rotateButton).toBeEnabled();
    await expect(rotateButton).toBeFocused();
    await expect(
      page.getByRole("dialog", { name: "One-time Pixel credentials" })
    ).toHaveCount(0);
  });

  test("shows truthful Pixel enrollment and Event polling health states", async ({
    page,
  }) => {
    await installSyntheticApi(page, {
      pixelAwaitingFirstSample: true,
      eventErrorOnly: true,
    });
    await page.goto("/dashboard/integrations");

    const pixel = page.getByRole("region", { name: "Pixel location" });
    await expect(
      pixel.getByText("Awaiting first sample", { exact: true }).first()
    ).toBeVisible();
    await expect(
      pixel.getByText("Enrolled / awaiting first sample")
    ).toBeVisible();
    await expect(pixel.getByText("No device samples received")).toBeVisible();
    await expect(
      pixel.getByText("Visit-derived", { exact: true })
    ).toBeVisible();
    await expect(pixel).not.toContainText(/latitude|longitude/i);

    const events = page.getByRole("region", { name: "Event discovery" });
    await expect(
      events.getByText("Polling error", { exact: true }).first()
    ).toBeVisible();
    await expect(events.getByText("Error: upstream_timeout")).toBeVisible();
    await expect(events.getByText(/Last poll /)).toBeVisible();
    await expect(events.getByText(/Next poll /)).toBeVisible();
    await expect(
      events.getByText("Ready for sources", { exact: true })
    ).toHaveCount(0);
    await expect(events).not.toContainText(FEED_URL);
  });

  test("renders non-active Calendar states and consumes an error callback", async ({
    page,
  }) => {
    const api = await installSyntheticApi(page);
    api.calendarConnection = {
      ...calendarConnection,
      status: "needs_reauth",
      errorCode: "google_invalid_grant",
    };
    await page.goto("/dashboard/integrations?calendar=error");

    const calendar = page.getByRole("region", { name: "Google Calendar" });
    await expect(
      calendar.getByText("Reconnect required", { exact: true }).first()
    ).toBeVisible();
    await expect(
      calendar.getByText("Connection issue: google_invalid_grant")
    ).toBeVisible();
    await expect(calendar.getByRole("checkbox")).toHaveCount(0);
    await expect(
      calendar.getByRole("button", { name: "Disconnect Google Calendar" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("status").filter({ hasText: "connection failed" })
    ).toBeVisible();
    await expect(page).toHaveURL(/\/dashboard\/integrations$/);

    api.calendarConnection = {
      ...calendarConnection,
      status: "disconnected",
      errorCode: null,
    };
    await page.reload();
    await expect(
      calendar.getByText("Disconnected", { exact: true }).first()
    ).toBeVisible();

    api.calendarConnection = {
      ...calendarConnection,
      status: "error",
      errorCode: "google_rate_limited",
    };
    await page.reload();
    await expect(
      calendar.getByText("Connection error", { exact: true }).first()
    ).toBeVisible();
    await expect(
      calendar.getByText("Connection issue: google_rate_limited")
    ).toBeVisible();
  });

  test("serializes overlapping Calendar source toggles without a stale rollback", async ({
    page,
  }) => {
    const api = await installSyntheticApi(page, {
      holdFirstCalendarPatchFailure: true,
    });
    await page.goto("/dashboard/integrations");
    const checkbox = page.getByRole("checkbox", {
      name: "Use Synthetic primary calendar",
    });

    await checkbox.uncheck();
    await checkbox.check();
    await checkbox.uncheck();
    await expect.poll(() => api.releaseCalendarPatchFailure).toBeDefined();
    api.releaseCalendarPatchFailure?.();

    await expect
      .poll(() => api.calendarSelectionPayloads)
      .toEqual([{ selected: false }, { selected: true }, { selected: false }]);
    await expect(checkbox).not.toBeChecked();
    await expect(page.getByText("Synthetic selection failure")).toHaveCount(0);
  });

  test("does not resurrect Calendar state when a source failure lands after disconnect", async ({
    page,
  }) => {
    const api = await installSyntheticApi(page, {
      holdFirstCalendarPatchFailure: true,
    });
    await page.goto("/dashboard/integrations");
    const calendar = page.getByRole("region", { name: "Google Calendar" });
    await calendar
      .getByRole("checkbox", { name: "Use Synthetic primary calendar" })
      .uncheck();
    await expect.poll(() => api.releaseCalendarPatchFailure).toBeDefined();

    await calendar
      .getByRole("button", { name: "Disconnect Google Calendar" })
      .click();
    await page
      .getByRole("dialog", { name: "Disconnect Google Calendar" })
      .getByRole("button", { name: "Disconnect" })
      .click();
    await expect.poll(() => api.calendarDisconnects).toBe(1);
    await expect(
      calendar.getByText("Not connected", { exact: true }).first()
    ).toBeVisible();
    const patchResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/calendars/calendar-source-primary")
    );
    api.releaseCalendarPatchFailure?.();
    await patchResponse;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );

    await expect(
      calendar.getByText("Not connected", { exact: true }).first()
    ).toBeVisible();
    await expect(calendar.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByText("Synthetic selection failure")).toHaveCount(0);
  });

  test("restores the last server-confirmed Calendar value when queued toggles fail", async ({
    page,
  }) => {
    const api = await installSyntheticApi(page, {
      holdFirstCalendarPatchFailure: true,
      calendarPatchFailures: 1,
    });
    await page.goto("/dashboard/integrations");
    const checkbox = page.getByRole("checkbox", {
      name: "Use Synthetic primary calendar",
    });

    await checkbox.uncheck();
    await checkbox.check();
    await expect.poll(() => api.releaseCalendarPatchFailure).toBeDefined();
    api.releaseCalendarPatchFailure?.();

    await expect
      .poll(() => api.calendarSelectionPayloads)
      .toEqual([{ selected: false }, { selected: true }]);
    await expect(
      page.getByRole("alert").filter({ hasText: "Synthetic selection failure" })
    ).toBeVisible();
    await expect(checkbox).toBeChecked();
    await expect(
      page.getByRole("status").filter({ hasText: "Calendar selection saved" })
    ).toHaveCount(0);
  });

  test("clears a stale Calendar success receipt before a failed update", async ({
    page,
  }) => {
    const api = await installSyntheticApi(page);
    await page.goto("/dashboard/integrations");
    const calendar = page.getByRole("region", { name: "Google Calendar" });
    const checkbox = calendar.getByRole("checkbox", {
      name: "Use Synthetic primary calendar",
    });

    await checkbox.uncheck();
    await expect(
      calendar
        .getByRole("status")
        .filter({ hasText: "Calendar selection saved" })
    ).toBeVisible();
    api.calendarPatchFailuresRemaining = 1;
    await checkbox.check();

    await expect(
      calendar
        .getByRole("alert")
        .filter({ hasText: "Synthetic selection failure" })
    ).toBeVisible();
    await expect(
      calendar
        .getByRole("status")
        .filter({ hasText: "Calendar selection saved" })
    ).toHaveCount(0);
    await expect(checkbox).not.toBeChecked();
  });

  test("retries one failed panel without removing ready panels", async ({
    page,
  }) => {
    await installSyntheticApi(page, { calendarFailures: 1 });
    await page.goto("/dashboard/integrations");

    const calendar = page.getByRole("region", { name: "Google Calendar" });
    const pixel = page.getByRole("region", { name: "Pixel location" });
    const events = page.getByRole("region", { name: "Event discovery" });
    await expect(calendar.getByRole("alert")).toContainText(
      "Synthetic Calendar failure"
    );
    await expect(
      pixel.getByText("Synthetic Pixel", { exact: true })
    ).toBeVisible();
    await expect(
      events.getByText("Synthetic Dubai AI", { exact: true })
    ).toBeVisible();

    await calendar
      .getByRole("button", { name: "Retry Google Calendar" })
      .click();
    await expect(
      calendar.getByText("Connected", { exact: true })
    ).toBeVisible();
    await expect(
      pixel.getByText("Synthetic Pixel", { exact: true })
    ).toBeVisible();
    await expect(
      events.getByText("Synthetic Dubai AI", { exact: true })
    ).toBeVisible();
  });

  test("is reachable, traps and restores dialog focus, and fits 412 by 915", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await installSyntheticApi(page);
    await page.goto("/dashboard/integrations");
    await expect(
      page.getByRole("link", { name: "Integrations" })
    ).toBeVisible();
    await page.getByRole("link", { name: "Integrations" }).click();
    await expect(page).toHaveURL(/\/dashboard\/integrations$/);

    const pixel = page.getByRole("region", { name: "Pixel location" });
    const revokeButton = pixel.getByRole("button", {
      name: "Revoke Synthetic Pixel",
    });
    await revokeButton.click();
    const dialog = page.getByRole("dialog", { name: "Revoke Pixel device" });
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    const confirm = dialog.getByRole("button", { name: "Revoke device" });
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(confirm).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(revokeButton).toBeFocused();

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
    }));
    expect(layout).toEqual({
      viewportWidth: 412,
      documentWidth: 412,
      bodyWidth: 412,
    });
    await page.screenshot({
      path: testInfo.outputPath("integrations-pixel-412x915.png"),
      fullPage: true,
    });
  });
});
