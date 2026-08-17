import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { backendFetch, BackendRequestError } from './api';
import { SESSION_COOKIE } from './constants';
import type { MerchantAccountStatus } from './types';

export interface SessionUser {
  id: string;
  username: string;
}

export interface MerchantProfile {
  merchant_name: string;
  user_ref: string | null;
  virtual_account_no: string | null;
  escrow_ifsc: string | null;
  available_balance: number;
  pending_balance: number;
  load_instructions: Record<string, string[]> | null;
  account_status: MerchantAccountStatus;
}

export interface UserProfile {
  user: SessionUser;
  merchant: MerchantProfile | null;
}

function sessionHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'x-session-token': token,
  };
}

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value?.trim();
  return token || null;
}

export async function getUserProfile(): Promise<UserProfile | null> {
  const token = await getSessionToken();

  if (!token) {
    return null;
  }

  return backendFetch<UserProfile>('/auth/me', {
    headers: sessionHeaders(token),
  });
}

export async function requireUserProfile(): Promise<UserProfile> {
  const token = await getSessionToken();

  if (!token) {
    redirect('/login');
  }

  try {
    return await backendFetch<UserProfile>('/auth/me', {
      headers: sessionHeaders(token),
    });
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401) {
      redirect('/api/auth/logout?redirect=/login');
    }

    throw error;
  }
}
