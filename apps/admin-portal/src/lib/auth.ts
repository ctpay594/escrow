import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { backendFetch } from './api';
import { ADMIN_SESSION_COOKIE } from './constants';

export interface AdminSession {
  id: string;
  username: string;
}

export async function getAdminSession(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  try {
    const data = await backendFetch<{ admin: AdminSession }>('/admin/auth/me', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return data.admin;
  } catch {
    return null;
  }
}

export async function requireAdminSession(): Promise<AdminSession> {
  const admin = await getAdminSession();

  if (!admin) {
    redirect('/api/auth/logout?redirect=/login');
  }

  return admin;
}
