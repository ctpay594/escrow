import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { backendFetch } from '@/lib/api';
import { ADMIN_SESSION_COOKIE } from '@/lib/constants';

async function getAdminToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;
}

export async function POST(request: NextRequest) {
  const token = await getAdminToken();

  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const userId = request.nextUrl.searchParams.get('user_id');
  const query = userId ? `?user_id=${encodeURIComponent(userId)}` : '';

  try {
    const data = await backendFetch(`/admin/transfers/reconcile-status${query}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to sync transfer status';

    return NextResponse.json({ message }, { status: 500 });
  }
}
