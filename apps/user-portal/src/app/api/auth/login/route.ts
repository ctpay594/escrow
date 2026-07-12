import { NextResponse } from 'next/server';
import { backendFetch } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/constants';
import { SESSION_COOKIE_OPTIONS } from '@/lib/session-cookie';

interface AuthResponse {
  user: { id: string; username: string };
  accessToken: string;
}

export async function POST(request: Request) {
  const body = await request.json();

  try {
    const data = await backendFetch<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const response = NextResponse.json({ user: data.user });
    response.cookies.set(SESSION_COOKIE, data.accessToken, SESSION_COOKIE_OPTIONS);

    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Login failed';

    return NextResponse.json({ message }, { status: 401 });
  }
}
