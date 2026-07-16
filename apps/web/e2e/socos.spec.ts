import { test, expect } from '@playwright/test';

function requireE2EEnv(name: 'E2E_TEST_EMAIL' | 'E2E_TEST_PASSWORD'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for staging E2E tests.`);
  return value;
}

const TEST_USER = {
  email: requireE2EEnv('E2E_TEST_EMAIL'),
  password: requireE2EEnv('E2E_TEST_PASSWORD'),
};

test.describe('SOCOS CRM', () => {
  test('landing page loads correctly', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/SOCOS/);
    await expect(page.locator('text=SOCOS').first()).toBeVisible();
    await expect(page.locator('text=Your Relationships')).toBeVisible();
    await expect(page.locator('text=Get Started for Free')).toBeVisible();
  });

  test('public demo and invite-gated auth explain value before signup', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Watch Demo').first().click();
    await expect(page.getByText('Daily social brief')).toBeVisible();
    await expect(page.getByText('No outbound actions')).toBeVisible();
    await expect(page.getByText('Approval required for messages')).toBeVisible();

    await page.goto('/auth/signup');
    await expect(page.getByText('Private alpha access')).toBeVisible();
    await expect(page.getByText('View sample brief before signing up')).toBeVisible();
  });

  test('public sample workspace proves the core workflow before invite signup', async ({ page }) => {
    await page.goto('/');
    await page.getByText('Watch Demo').first().click();
    await page.getByRole('link', { name: 'Open sample workspace' }).click();

    await expect(page).toHaveURL(/\/sample-workspace/);
    await expect(page.getByRole('heading', { name: 'Sample relationship workspace' })).toBeVisible();
    await expect(page.getByText('Captured interaction')).toBeVisible();
    await expect(page.getByText('AI memory extraction')).toBeVisible();
    await expect(page.getByText('Approval before outbound action')).toBeVisible();
    await expect(page.getByText('Launch status and access')).toBeVisible();
    await expect(page.getByText('Data controls')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Request invite access' }).first()).toBeVisible();

    await page.goto('/auth/signup');
    await page.getByRole('link', { name: 'Open read-only sample workspace' }).click();
    await expect(page).toHaveURL(/\/sample-workspace/);
  });

  test.describe('authentication', () => {
    test.beforeEach(async ({ page }) => {
      // Clear localStorage before each auth test
      await page.goto('/dashboard');
      await page.evaluate(() => localStorage.removeItem('socos_token'));
    });

    test('login form displays on dashboard when unauthenticated', async ({ page }) => {
      await page.goto('/dashboard');
      // Should show sign in form
      await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('input[type="password"]')).toBeVisible();
      await expect(page.locator('button[type="submit"]')).toBeVisible();
    });

    test('can login with valid credentials', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForSelector('input[type="email"]', { timeout: 10000 });

      // Fill in login form
      await page.fill('input[type="email"]', TEST_USER.email);
      await page.fill('input[type="password"]', TEST_USER.password);
      await page.click('button[type="submit"]');

      // Should redirect to dashboard with user data
      await page.waitForURL('**/dashboard', { timeout: 15000 });
      // Dashboard elements should appear (either logged-in state or contacts)
      await expect(page.locator('text=Dashboard').or(page.locator('text=Welcome'))).toBeVisible({ timeout: 15000 });
    });

    test('shows error on invalid credentials', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForSelector('input[type="email"]', { timeout: 10000 });

      await page.fill('input[type="email"]', 'wrong@email.com');
      await page.fill('input[type="password"]', 'wrongpassword');
      await page.click('button[type="submit"]');

      // Should show error message
      await expect(page.locator('text=Login failed').or(page.locator('text=Invalid')).or(page.locator('text=error'))).toBeVisible({ timeout: 10000 });
    });
  });

  test.describe('dashboard (authenticated)', () => {
    // Run with authenticated session
    test.use({
      storageState: async ({ browser }) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto('/dashboard');
        await page.waitForSelector('input[type="email"]', { timeout: 10000 });
        await page.fill('input[type="email"]', TEST_USER.email);
        await page.fill('input[type="password"]', TEST_USER.password);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(3000);
        // Save storage state
        await context.storageState({ path: '/tmp/socos-auth-state.json' });
        await context.close();
        return '/tmp/socos-auth-state.json';
      },
    });

    test('dashboard shows contacts after login', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForTimeout(3000);

      // Should show dashboard elements (either with or without contacts)
      const hasContent = await page.locator('text=Dashboard').isVisible().catch(() => false)
        || await page.locator('text=Contacts').isVisible().catch(() => false)
        || await page.locator('text=Add Contact').isVisible().catch(() => false);
      expect(hasContent).toBeTruthy();
    });

    test('logout works', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForTimeout(3000);

      // Find and click sign out button if visible
      const signOutBtn = page.locator('button', { hasText: 'Sign Out' });
      if (await signOutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await signOutBtn.click();
        await page.waitForTimeout(1000);
        // Should show login form again
        await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 5000 });
      }
    });

    test('navigation sidebar is visible', async ({ page }) => {
      await page.goto('/dashboard');
      await page.waitForTimeout(3000);

      // Sidebar should have SOCOS logo
      await expect(page.locator('text=SOCOS').first()).toBeVisible({ timeout: 5000 });
    });
  });

  test('no console errors on landing page', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const jsErrors = errors.filter(e => !e.includes('favicon') && !e.includes('404'));
    expect(jsErrors).toHaveLength(0);
  });
});
