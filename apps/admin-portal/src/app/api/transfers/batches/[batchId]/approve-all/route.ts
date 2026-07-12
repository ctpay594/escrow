import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { backendFetch } from '@/lib/api';
import { ADMIN_SESSION_COOKIE } from '@/lib/constants';

async function getAdminToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  const token = await getAdminToken();

  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const { batchId } = await params;

  try {
    const data = await backendFetch(
      `/admin/transfers/batches/${batchId}/approve-all`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to approve batch';

    return NextResponse.json({ message }, { status: 400 });
  }
}
