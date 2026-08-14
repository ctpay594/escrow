import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { backendFetch } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/constants';

async function getUserToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

export async function GET() {
  const token = await getUserToken();

  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await backendFetch('/transfers/deposits', {
      headers: { Authorization: `Bearer ${token}` },
    });

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to load deposits';

    return NextResponse.json({ message }, { status: 500 });
  }
}
