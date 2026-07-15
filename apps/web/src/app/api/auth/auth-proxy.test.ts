import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as login } from './login/route';
import { POST as register } from './register/route';

afterEach(() => {
  delete process.env.API_INTERNAL_URL;
  delete process.env.SOCOS_API_URL;
  vi.unstubAllGlobals();
});

describe('server-side auth proxy routing', () => {
  it.each([
    ['login', login],
    ['register', register],
  ])('proxies %s to the internal API path exactly once', async (action, handler) => {
    process.env.API_INTERNAL_URL = 'http://api:3001/';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accessToken: 'synthetic-token', user: {} }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const request = new NextRequest(`http://web.test/api/auth/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'synthetic@example.test', password: 'synthetic-password' }),
    });

    await handler(request);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(`http://api:3001/api/auth/${action}`);
  });
});
