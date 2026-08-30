import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { backendFetch, errorStatusFromMessage } from '@/lib/api';
import { ADMIN_SESSION_COOKIE } from '@/lib/constants';

async function getAdminToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;
}

export async function GET(request: NextRequest) {
  const token = await getAdminToken();

  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const params = new URLSearchParams();
  const userId = request.nextUrl.searchParams.get('user_id');
  const from = request.nextUrl.searchParams.get('from');
  const to = request.nextUrl.searchParams.get('to');

  if (userId) params.set('user_id', userId);
  if (from) params.set('from', from);
  if (to) params.set('to', to);

  const query = params.size > 0 ? `?${params.toString()}` : '';

  try {
    const data = await backendFetch(`/admin/analytics${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to load analytics';

    return NextResponse.json(
      { message },
      { status: errorStatusFromMessage(message) },
    );
  }
}
