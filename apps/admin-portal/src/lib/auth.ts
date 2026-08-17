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

export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value?.trim();

  if (!token) {
    return null;
  }

  const data = await backendFetch<{ admin: AdminSession }>('/admin/auth/me', {
    headers: sessionHeaders(token),
  });

  return data.admin;
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

    throw error;
  }
}
