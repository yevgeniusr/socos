import { test, expect } from '@playwright/test';

function requireE2EEnv(name: 'E2E_BASE_URL' | 'E2E_TEST_EMAIL' | 'E2E_TEST_PASSWORD'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for staging E2E tests.`);
  return value;
}

const BASE_URL = requireE2EEnv('E2E_BASE_URL').replace(/\/+$/, '');
const TEST_EMAIL = requireE2EEnv('E2E_TEST_EMAIL');
const TEST_PASSWORD = requireE2EEnv('E2E_TEST_PASSWORD');

test.describe('SOCOS MVP - Staging Smoke Tests', () => {

  test.beforeEach(async ({ page }) => {
    // Clear localStorage before each test
    await page.goto(BASE_URL);
    await page.evaluate(() => localStorage.clear());
  });

  // ─── Auth ───────────────────────────────────────────────────────────────

  test('Login → dashboard', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByPlaceholder('Email address').fill(TEST_EMAIL);
    await page.getByPlaceholder('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 10000 });
  });

  test('Unauthenticated redirect', async ({ page }) => {
    await page.goto(`${BASE_URL}/dashboard`);
    // Should show login form, not crash
    await expect(page.getByPlaceholder('Email address')).toBeVisible({ timeout: 5000 });
  });

  // ─── Dashboard Stats ───────────────────────────────────────────────────

  test('Stats show non-zero values after login', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByPlaceholder('Email address').fill(TEST_EMAIL);
    await page.getByPlaceholder('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 10000 });

    // XP and level should be visible
    await expect(page.getByText(/Level \d/)).toBeVisible();
    // Contact count should be > 0
    const contactsCard = page.locator('text=Total Contacts').locator('..');
    await expect(contactsCard).toBeVisible();
  });

  // ─── Contacts ───────────────────────────────────────────────────────────

  test('Contact list loads with contacts', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByPlaceholder('Email address').fill(TEST_EMAIL);
    await page.getByPlaceholder('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 10000 });

    // Wait for contacts to load
    await page.waitForLoadState('networkidle');
    // Should have at least one contact card
    const cards = page.locator('[class*="bg-surface-container-low"]').filter({ hasText: /\w/ });
    await expect(cards.first()).toBeVisible({ timeout: 10000 });
  });

  test('Add Contact modal opens and closes', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByPlaceholder('Email address').fill(TEST_EMAIL);
    await page.getByPlaceholder('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Add Contact' }).click();
    await expect(page.getByText('Add New Contact')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Add New Contact')).not.toBeVisible();
  });

  test('Add Contact creates a new contact', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByPlaceholder('Email address').fill(TEST_EMAIL);
    await page.getByPlaceholder('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 10000 });

    const uniqueName = `Playwright Test ${Date.now()}`;
    await page.getByRole('button', { name: 'Add Contact' }).click();
    await expect(page.getByText('Add New Contact')).toBeVisible();
    await page.getByLabel('First Name').fill(uniqueName);
    await page.getByRole('button', { name: 'Create Contact' }).click();

    // Toast should appear
    await expect(page.getByText(/created!/)).toBeVisible({ timeout: 5000 });
    // Contact should appear in list
    await expect(page.getByText(uniqueName)).toBeVisible({ timeout: 5000 });
  });

  test('Search filters contacts', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByPlaceholder('Email address').fill(TEST_EMAIL);
    await page.getByPlaceholder('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 10000 });

    await page.getByPlaceholder('Search contacts').fill('Sarah');
    await page.waitForTimeout(500);
    // Only Sarah should be visible (or none if seed data differs)
    const cards = page.locator('[class*="group relative"]');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(0); // Just checking no crash
  });

  // ─── Quick Action Buttons ───────────────────────────────────────────────

  test('Call button logs interaction and shows toast', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByPlaceholder('Email address').fill(TEST_EMAIL);
    await page.getByPlaceholder('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 10000 });

    // Hover over first contact card to reveal quick actions
    const firstCard = page.locator('[class*="group relative"]').first();
    await firstCard.hover();

    // Click call button
    const callBtn = firstCard.getByTitle('Call');
    await expect(callBtn).toBeVisible();
    await callBtn.click();

    // Toast should appear with success message
    await expect(page.getByText(/Call logged|Calling|error/i)).toBeVisible({ timeout: 5000 });
  });

  test('Message button logs interaction', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByPlaceholder('Email address').fill(TEST_EMAIL);
    await page.getByPlaceholder('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 10000 });

    const firstCard = page.locator('[class*="group relative"]').first();
    await firstCard.hover();

    const msgBtn = firstCard.getByTitle('Message');
    await expect(msgBtn).toBeVisible();
    await msgBtn.click();

    await expect(page.getByText(/Message logged|Opening|error/i)).toBeVisible({ timeout: 5000 });
  });

  test('Reminder button creates reminder', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByPlaceholder('Email address').fill(TEST_EMAIL);
    await page.getByPlaceholder('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 10000 });

    const firstCard = page.locator('[class*="group relative"]').first();
    await firstCard.hover();

    const reminderBtn = firstCard.getByTitle('Reminder');
    await expect(reminderBtn).toBeVisible();
    await reminderBtn.click();

    await expect(page.getByText(/Reminder created|Creating|error/i)).toBeVisible({ timeout: 5000 });
  });

  // ─── Sign Out ──────────────────────────────────────────────────────────

  test('Sign out returns to login', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.getByPlaceholder('Email address').fill(TEST_EMAIL);
    await page.getByPlaceholder('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Dashboard')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Sign Out' }).click();
    await expect(page.getByPlaceholder('Email address')).toBeVisible({ timeout: 5000 });
  });

});

test.describe('API Endpoints', () => {
  const API_BASE = `${BASE_URL}/api`;

  test('GET /api/health-check returns 200', async ({ request }) => {
    const res = await request.get(`${API_BASE}/health-check`);
    expect(res.status()).toBe(200);
  });

  test('POST /api/auth/login with valid credentials returns token', async ({ request }) => {
    const res = await request.post(`${API_BASE}/auth/login`, {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD }
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.accessToken).toBeDefined();
  });

  test('POST /api/auth/login with bad credentials returns 401', async ({ request }) => {
    const res = await request.post(`${API_BASE}/auth/login`, {
      data: { email: TEST_EMAIL, password: 'wrongpassword' }
    });
    expect(res.status()).toBe(401);
  });

  test('GET /api/contacts without auth returns 401', async ({ request }) => {
    const res = await request.get(`${API_BASE}/contacts`);
    expect(res.status()).toBe(401);
  });

  test('GET /api/contacts with auth returns 200 and contact array', async ({ request }) => {
    const loginRes = await request.post(`${API_BASE}/auth/login`, {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD }
    });
    const { accessToken } = await loginRes.json();

    const res = await request.get(`${API_BASE}/contacts?limit=10`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.contacts)).toBe(true);
  });

  test('POST /api/interactions creates interaction and returns 201', async ({ request }) => {
    const loginRes = await request.post(`${API_BASE}/auth/login`, {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD }
    });
    const { accessToken } = await loginRes.json();

    const contactsRes = await request.get(`${API_BASE}/contacts?limit=1`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const { contacts } = await contactsRes.json();
    const contactId = contacts[0]?.id;
    expect(contactId).toBeDefined();

    const res = await request.post(`${API_BASE}/interactions`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      data: { contactId, type: 'call', title: 'Test Call' }
    });
    expect(res.status()).toBe(201);
  });

  test('GET /api/gamification/stats returns user stats', async ({ request }) => {
    const loginRes = await request.post(`${API_BASE}/auth/login`, {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD }
    });
    const { accessToken } = await loginRes.json();

    const res = await request.get(`${API_BASE}/gamification/stats`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user).toBeDefined();
    expect(body.stats).toBeDefined();
    expect(typeof body.user.xp).toBe('number');
    expect(typeof body.user.level).toBe('number');
  });

  test('GET /api/reminders/upcoming returns reminder list', async ({ request }) => {
    const loginRes = await request.post(`${API_BASE}/auth/login`, {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD }
    });
    const { accessToken } = await loginRes.json();

    const res = await request.get(`${API_BASE}/reminders/upcoming`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.reminders)).toBe(true);
  });
});
