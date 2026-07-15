import { defineConfig, devices } from "@playwright/test";
import { getStagingBaseUrl } from "../../apps/web/e2e-host-policy";

const baseURL = getStagingBaseUrl();

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "tests/e2e/playwright-report" }],
  ],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: undefined, // Uses the explicitly configured staging deployment.
});
