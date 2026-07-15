import { NextRequest, NextResponse } from 'next/server';
import { getServerApiBaseUrl } from '@/lib/server-api';

const COOKIE_NAME = 'socos_token';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const headers: Record<string, string> = {
      'Content-Type': request.headers.get('content-type') || 'application/json',
    };

    const res = await fetch(`${getServerApiBaseUrl()}/api/auth/login`, {
      method: 'POST',
      headers,
      body,
    });

    const data = await res.json();

    if (!res.ok || !data.accessToken) {
      return NextResponse.json(
        { message: data.message || 'Invalid credentials' },
        { status: res.status || 401 }
      );
    }

    // Set httpOnly JWT cookie (secure in production)
    const isProduction = process.env.NODE_ENV === 'production';
    const response = NextResponse.json({
      accessToken: data.accessToken,
      user: data.user,
    });

    response.cookies.set(COOKIE_NAME, data.accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch (err: any) {
    console.error('[/api/auth/login]', err);
    return NextResponse.json(
      { message: 'Auth service unavailable' },
      { status: 502 }
    );
  }
}
