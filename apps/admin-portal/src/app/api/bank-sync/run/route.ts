import { NextResponse } from 'next/server';
import { backendFetch, errorStatusFromMessage } from '@/lib/api';
import { getAdminSessionToken } from '@/lib/admin-session';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST() {
  const token = await getAdminSessionToken();

  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await backendFetch('/admin/bank-sync/run', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 300_000,
    });

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'HDFC statement sync failed';

    return NextResponse.json(
      { message },
      { status: errorStatusFromMessage(message) },
    );
  }
}
