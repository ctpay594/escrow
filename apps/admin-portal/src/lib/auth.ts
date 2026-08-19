import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { backendFetch, BackendRequestError } from './api';
import { ADMIN_SESSION_COOKIE } from './constants';

export interface AdminSession {
  id: string;
  username: string;
}

function sessionHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'x-session-token': token,
  };
}

function sessionFromJwt(token: string): AdminSession | null {
  const parts = token.split('.');

  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    ) as { sub?: unknown; username?: unknown };

    if (typeof payload.sub === 'string' && typeof payload.username === 'string') {
      return { id: payload.sub, username: payload.username };
    }
  } catch {
    return null;
  }

  return null;
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value?.trim();

  if (!token) {
    return null;
  }

  try {
    const data = await backendFetch<{ admin: AdminSession }>('/admin/auth/me', {
      headers: sessionHeaders(token),
    });

    return data.admin;
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401) {
      return null;
    }

    return sessionFromJwt(token);
  }
}

export async function requireAdminSession(): Promise<AdminSession> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value?.trim();

  if (!token) {
    redirect('/login');
  }

  try {
    const data = await backendFetch<{ admin: AdminSession }>('/admin/auth/me', {
      headers: sessionHeaders(token),
    });

    return data.admin;
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401) {
      redirect('/api/auth/logout?redirect=/login');
    }

    const fallback = sessionFromJwt(token);

    if (fallback) {
      return fallback;
    }

    throw error;
  }
}
