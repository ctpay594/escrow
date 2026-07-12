import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { backendFetch } from './api';
import { SESSION_COOKIE } from './constants';

export interface SessionUser {
  id: string;
  username: string;
}

import type { MerchantAccountStatus } from './types';

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

export async function getUserProfile(): Promise<UserProfile | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  try {
    return await backendFetch<UserProfile>('/auth/me', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    return null;
  }
}

export async function requireUserProfile(): Promise<UserProfile> {
  const profile = await getUserProfile();

  if (!profile) {
    redirect('/api/auth/logout?redirect=/login');
  }

  return profile;
}
