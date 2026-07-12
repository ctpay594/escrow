import { NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE } from '@/lib/constants';
import { clearSessionCookie } from '@/lib/session-cookie';

function logoutResponse(request: Request, redirectTo: string) {
  const target = new URL(redirectTo, request.url);
  const response = NextResponse.redirect(target);
  clearSessionCookie(response, ADMIN_SESSION_COOKIE);
  return response;
}

export async function GET(request: Request) {
  const redirectTo =
    new URL(request.url).searchParams.get('redirect') ?? '/login';

  return logoutResponse(request, redirectTo);
}

export async function POST() {
  const response = NextResponse.json({ message: 'Logged out' });
  clearSessionCookie(response, ADMIN_SESSION_COOKIE);
  return response;
}
