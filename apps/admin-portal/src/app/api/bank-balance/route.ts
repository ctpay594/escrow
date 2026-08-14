import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { backendFetch, errorStatusFromMessage } from '@/lib/api';
import { ADMIN_SESSION_COOKIE } from '@/lib/constants';

export const dynamic = 'force-dynamic';

async function getAdminToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;
}

export async function GET() {
  const token = await getAdminToken();

  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await backendFetch('/admin/bank/balance', {
      headers: { Authorization: `Bearer ${token}` },
    });

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to load company bank balance';

    return NextResponse.json(
      { message },
      { status: errorStatusFromMessage(message) },
    );
  }
}
