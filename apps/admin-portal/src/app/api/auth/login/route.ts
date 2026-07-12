import { NextResponse } from 'next/server';
import { backendFetch } from '@/lib/api';
import { ADMIN_SESSION_COOKIE } from '@/lib/constants';
import { SESSION_COOKIE_OPTIONS } from '@/lib/session-cookie';

interface AdminAuthResponse {
  admin: { id: string; username: string };
  accessToken: string;
}

export async function POST(request: Request) {
  const body = await request.json();

  try {
    const data = await backendFetch<AdminAuthResponse>('/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const response = NextResponse.json({ admin: data.admin });
    response.cookies.set(ADMIN_SESSION_COOKIE, data.accessToken, SESSION_COOKIE_OPTIONS);

    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Login failed';

    return NextResponse.json({ message }, { status: 401 });
  }
}
