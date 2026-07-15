import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error('E2E_BASE_URL is required and must target a staging deployment.');
}
if (new URL(baseURL).hostname === 'socos.rachkovan.com') {
  throw new Error('E2E_BASE_URL must not target the production SOCOS hostname.');
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: undefined,
});
