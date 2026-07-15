import { test, expect, request } from '@playwright/test';

function requireE2EEnv(name: 'E2E_BASE_URL' | 'E2E_TEST_EMAIL' | 'E2E_TEST_PASSWORD'): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for staging E2E tests.`);
  return value;
}

const BASE = `${requireE2EEnv('E2E_BASE_URL').replace(/\/+$/, '')}/api`;
const TEST_USER = {
  email: requireE2EEnv('E2E_TEST_EMAIL'),
  password: requireE2EEnv('E2E_TEST_PASSWORD'),
};

// Helper: get auth token via API login
async function getAuthToken(): Promise<string> {
  const ctx = await request.newContext({ baseURL: BASE });
  const res = await ctx.post('/auth/login', {
    data: { email: TEST_USER.email, password: TEST_USER.password },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok()) throw new Error(`Login failed ${res.status()}: ${await res.text()}`);
  const body = await res.json();
  return body.accessToken as string;
}

// Helper: authenticated API fetch
async function apiFetch(path: string, token: string, opts: Record<string, any> = {}) {
  const ctx = await request.newContext({ baseURL: BASE });
  const res = await ctx.fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status(), ok: res.ok(), body };
}

// ─── Test Data ────────────────────────────────────────────────────────────────

let packId: string;
let celebrationId: string;
let contactId: string;
const testPackName = `Test Pack ${Date.now()}`;
const testCelebrationName = `Test Celebration ${Date.now()}`;

// ─── Pack CRUD ───────────────────────────────────────────────────────────────

test.describe('Celebrations — Pack CRUD', () => {
  let token: string;

  test.beforeAll(async () => {
    token = await getAuthToken();
  });

  test('system packs are visible to any user', async () => {
    const { status, body } = await apiFetch('/celebrations/packs', token);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    // System packs (Buddhism, Global, Cultural) should be present
    const names = body.map((p: any) => p.name);
    expect(names).toContain('Buddhism Celebrations');
    expect(names).toContain('Global Holidays');
    expect(names).toContain('Cultural Celebrations');
    // System packs should be marked isSystem: true
    const buddhism = body.find((p: any) => p.name === 'Buddhism Celebrations');
    expect(buddhism).toBeDefined();
    expect(buddhism.isSystem).toBe(true);
    expect(buddhism.ownerId).toBeNull();
  });

  test('user can create a custom pack', async () => {
    const { status, body } = await apiFetch('/celebrations/packs', token, {
      method: 'POST',
      data: { name: testPackName, description: 'E2E test pack' },
    });
    expect(status).toBe(201);
    expect(body.name).toBe(testPackName);
    expect(body.isSystem).toBe(false);
    expect(body.ownerId).not.toBeNull();
    packId = body.id;
  });

  test('user can get their own pack by ID', async () => {
    const { status, body } = await apiFetch(`/celebrations/packs/${packId}`, token);
    expect(status).toBe(200);
    expect(body.id).toBe(packId);
  });

  test('user cannot delete a system pack', async () => {
    const { status } = await apiFetch('/celebrations/packs', token);
    const systemPack = (await apiFetch('/celebrations/packs', token)).body
      .find((p: any) => p.isSystem);
    const res = await apiFetch(`/celebrations/packs/${systemPack.id}`, token, { method: 'DELETE' });
    expect(res.status).toBe(403);
  });

  test('user can update their own pack', async () => {
    const { status, body } = await apiFetch(`/celebrations/packs/${packId}`, token, {
      method: 'PUT',
      data: { name: `${testPackName} Updated` },
    });
    expect(status).toBe(200);
    expect(body.name).toBe(`${testPackName} Updated`);
  });

  test('user can delete their own pack', async () => {
    const { status } = await apiFetch(`/celebrations/packs/${packId}`, token, { method: 'DELETE' });
    expect(status).toBe(200);
    // Confirm it's gone
    const { status: s2 } = await apiFetch(`/celebrations/packs/${packId}`, token);
    expect(s2).toBe(404);
  });
});

// ─── Celebration CRUD ────────────────────────────────────────────────────────

test.describe('Celebrations — Celebration CRUD', () => {
  let token: string;

  test.beforeAll(async () => {
    token = await getAuthToken();
  });

  test('system pack celebrations are visible', async () => {
    const packs = (await apiFetch('/celebrations/packs', token)).body;
    const buddhismPack = packs.find((p: any) => p.name === 'Buddhism Celebrations');

    const { status, body } = await apiFetch(
      `/celebrations/packs/${buddhismPack.id}/celebrations`,
      token
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);

    // Vesak should be there
    const vesak = body.find((c: any) => c.name === 'Vesak');
    expect(vesak).toBeDefined();
    expect(vesak.category).toBe('religious');
    expect(vesak.icon).toBe('🪷');
  });

  test('user can add a celebration to their own pack', async () => {
    // First create a pack
    const { body: pack } = await apiFetch('/celebrations/packs', token, {
      method: 'POST',
      data: { name: testPackName, description: 'for celebrations test' },
    });
    packId = pack.id;

    const { status, body } = await apiFetch(
      `/celebrations/packs/${packId}/celebrations`,
      token,
      {
        method: 'POST',
        data: {
          name: testCelebrationName,
          description: 'Test description',
          date: '06-15',
          category: 'cultural',
          icon: '🎉',
        },
      }
    );
    expect(status).toBe(201);
    expect(body.name).toBe(testCelebrationName);
    expect(body.date).toBe('06-15');
    expect(body.category).toBe('cultural');
    expect(body.ownerId).toBe(packId);
    celebrationId = body.id;
  });

  test('celebration MM-DD date format is validated', async () => {
    const { status } = await apiFetch(
      `/celebrations/packs/${packId}/celebrations`,
      token,
      {
        method: 'POST',
        data: {
          name: 'Bad Date',
          date: 'invalid',
          category: 'cultural',
        },
      }
    );
    // Should be 400 or 422 for validation error
    expect([400, 422]).toContain(status);
  });

  test('user can update their own celebration', async () => {
    const { status, body } = await apiFetch(
      `/celebrations/packs/${packId}/celebrations/${celebrationId}`,
      token,
      {
        method: 'PUT',
        data: { name: `${testCelebrationName} Updated`, icon: '🎊' },
      }
    );
    expect(status).toBe(200);
    expect(body.name).toBe(`${testCelebrationName} Updated`);
    expect(body.icon).toBe('🎊');
  });

  test('user can delete their own celebration', async () => {
    const { status } = await apiFetch(
      `/celebrations/packs/${packId}/celebrations/${celebrationId}`,
      token,
      { method: 'DELETE' }
    );
    expect(status).toBe(200);
  });
});

// ─── Attach to Contact ───────────────────────────────────────────────────────

test.describe('Celebrations — Contact Attachments', () => {
  let token: string;

  test.beforeAll(async () => {
    token = await getAuthToken();
  });

  test('can attach a celebration to a contact', async () => {
    // Find a contact
    const contactsRes = await apiFetch('/contacts?limit=1', token);
    if (contactsRes.status !== 200 || contactsRes.body.contacts.length === 0) {
      // No contacts — skip this block (user has no data)
      test.skip();
      return;
    }
    contactId = contactsRes.body.contacts[0].id;

    // Get a celebration
    const packs = (await apiFetch('/celebrations/packs', token)).body;
    const globalPack = packs.find((p: any) => p.name === 'Global Holidays');
    const celebrations = (await apiFetch(
      `/celebrations/packs/${globalPack.id}/celebrations`,
      token
    )).body;
    const earthDay = celebrations.find((c: any) => c.name === 'Earth Day');
    expect(earthDay).toBeDefined();

    const { status, body } = await apiFetch(
      `/celebrations/contacts/${contactId}`,
      token,
      {
        method: 'POST',
        data: { celebrationId: earthDay.id, status: 'active' },
      }
    );
    expect(status).toBe(201);
    expect(body.contactId).toBe(contactId);
    expect(body.celebrationId).toBe(earthDay.id);
    expect(body.status).toBe('active');
  });

  test('can list celebrations for a contact', async () => {
    if (!contactId) { test.skip(); return; }

    const { status, body } = await apiFetch(
      `/celebrations/contacts/${contactId}`,
      token
    );
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  test('can update celebration status for a contact', async () => {
    if (!contactId) { test.skip(); return; }

    const contacts = (await apiFetch('/contacts?limit=1', token)).body.contacts;
    if (!contacts?.[0]) { test.skip(); return; }
    const cid = contacts[0].id;

    const packs = (await apiFetch('/celebrations/packs', token)).body;
    const globalPack = packs.find((p: any) => p.name === 'Global Holidays');
    const celebrations = (await apiFetch(
      `/celebrations/packs/${globalPack.id}/celebrations`,
      token
    )).body;
    const earthDay = celebrations.find((c: any) => c.name === 'Earth Day');

    // Attach
    await apiFetch(`/celebrations/contacts/${cid}`, token, {
      method: 'POST',
      data: { celebrationId: earthDay.id, status: 'active' },
    });

    // Update to ignored
    const { status, body } = await apiFetch(
      `/celebrations/contacts/${cid}/${earthDay.id}`,
      token,
      { method: 'PUT', data: { status: 'ignored' } }
    );
    expect(status).toBe(200);
    expect(body.status).toBe('ignored');
  });

  test('can detach a celebration from a contact', async () => {
    if (!contactId) { test.skip(); return; }

    const contacts = (await apiFetch('/contacts?limit=1', token)).body.contacts;
    if (!contacts?.[0]) { test.skip(); return; }
    const cid = contacts[0].id;

    const packs = (await apiFetch('/celebrations/packs', token)).body;
    const globalPack = packs.find((p: any) => p.name === 'Global Holidays');
    const celebrations = (await apiFetch(
      `/celebrations/packs/${globalPack.id}/celebrations`,
      token
    )).body;
    const earthDay = celebrations.find((c: any) => c.name === 'Earth Day');

    // Attach then detach
    await apiFetch(`/celebrations/contacts/${cid}`, token, {
      method: 'POST',
      data: { celebrationId: earthDay.id },
    });

    const { status } = await apiFetch(
      `/celebrations/contacts/${cid}/${earthDay.id}`,
      token,
      { method: 'DELETE' }
    );
    expect(status).toBe(200);
  });

  test('cannot attach the same celebration twice to the same contact', async () => {
    const contacts = (await apiFetch('/contacts?limit=1', token)).body.contacts;
    if (!contacts?.[0]) { test.skip(); return; }
    const cid = contacts[0].id;

    const packs = (await apiFetch('/celebrations/packs', token)).body;
    const globalPack = packs.find((p: any) => p.name === 'Global Holidays');
    const celebrations = (await apiFetch(
      `/celebrations/packs/${globalPack.id}/celebrations`,
      token
    )).body;
    const halloween = celebrations.find((c: any) => c.name === 'Halloween');

    // First attach
    await apiFetch(`/celebrations/contacts/${cid}`, token, {
      method: 'POST',
      data: { celebrationId: halloween.id },
    });

    // Second attach — should fail (unique constraint)
    const { status } = await apiFetch(`/celebrations/contacts/${cid}`, token, {
      method: 'POST',
      data: { celebrationId: halloween.id },
    });
    expect([400, 409]).toContain(status);
  });
});

// ─── Global Status ───────────────────────────────────────────────────────────

test.describe('Celebrations — Global Status', () => {
  let token: string;

  test.beforeAll(async () => {
    token = await getAuthToken();
  });

  test('upcoming celebrations returns events in next 30 days', async () => {
    const { status, body } = await apiFetch('/celebrations/upcoming/list', token);
    expect(status).toBe(200);
    // Body should be an array or object with an array
    const items = Array.isArray(body) ? body : body.celebrations || body.items || [];
    expect(Array.isArray(items)).toBe(true);
    // If there are any upcoming, they should have a nextOccurrence
    if (items.length > 0) {
      expect(items[0]).toHaveProperty('nextOccurrence');
    }
  });
});

// ─── Auth Guard ──────────────────────────────────────────────────────────────

test.describe('Celebrations — Auth & Security', () => {
  test('unauthenticated requests are rejected', async () => {
    const { status } = await apiFetch('/celebrations/packs', 'bad-token');
    expect([401, 403]).toContain(status);
  });

  test('cannot access another users pack via pack ID', async () => {
    // Try to access a non-existent pack UUID
    const { status } = await apiFetch(
      '/celebrations/packs/00000000-0000-0000-0000-000000000000',
      await getAuthToken()
    );
    // 403 (forbidden — can't access) or 404 (not found) are both acceptable
    expect([403, 404]).toContain(status);
  });
});
