import { cookies } from 'next/headers';
import { ADMIN_SESSION_COOKIE } from '@/lib/constants';

export async function getAdminSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;
}
