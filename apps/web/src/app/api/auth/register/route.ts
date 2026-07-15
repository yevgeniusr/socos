import { NextRequest, NextResponse } from 'next/server';
import { getServerApiBaseUrl } from '@/lib/server-api';

const COOKIE_NAME = 'socos_token';

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const headers: Record<string, string> = {
      'Content-Type': request.headers.get('content-type') || 'application/json',
    };

    const res = await fetch(`${getServerApiBaseUrl()}/api/auth/register`, {
      method: 'POST',
      headers,
      body,
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { message: data.message || 'Registration failed' },
        { status: res.status || 400 }
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
  } catch {
    return NextResponse.json({ message: 'Registration service unavailable' }, { status: 502 });
  }
}
