import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error('E2E_BASE_URL is required and must target a staging deployment.');
}
if (new URL(baseURL).hostname === 'socos.rachkovan.com') {
  throw new Error('E2E_BASE_URL must not target the production SOCOS hostname.');
}

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'tests/e2e/playwright-report' }],
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: undefined, // Uses the explicitly configured staging deployment.
});
