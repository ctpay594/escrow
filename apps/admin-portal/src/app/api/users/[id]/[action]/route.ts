import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { backendFetch, errorStatusFromMessage } from '@/lib/api';
import { ADMIN_SESSION_COOKIE } from '@/lib/constants';

async function getAdminToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(ADMIN_SESSION_COOKIE)?.value ?? null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const token = await getAdminToken();

  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const { id, action } = await params;
  const body = await request.json();

  const path =
    action === 'username'
      ? `/admin/users/${id}/username`
      : `/admin/users/${id}/password`;

  try {
    const data = await backendFetch(path, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Update failed';

    return NextResponse.json(
      { message },
      { status: errorStatusFromMessage(message) === 401 ? 401 : 400 },
    );
  }
}
