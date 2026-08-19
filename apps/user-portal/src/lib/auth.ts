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

function sessionFromJwt(token: string): SessionUser | null {
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

export function profileFromJwt(token: string): UserProfile | null {
  const user = sessionFromJwt(token);

  if (!user) {
    return null;
  }

  return {
    user,
    merchant: {
      merchant_name: user.username,
      user_ref: null,
      virtual_account_no: null,
      escrow_ifsc: null,
      available_balance: 0,
      pending_balance: 0,
      load_instructions: null,
      account_status: 'active',
    },
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

  try {
    return await backendFetch<UserProfile>('/auth/me', {
      headers: sessionHeaders(token),
    });
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 401) {
      return null;
    }

    throw error;
  }
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

    const fallback = profileFromJwt(token);

    if (fallback) {
      return fallback;
    }

    throw error;
  }
}
