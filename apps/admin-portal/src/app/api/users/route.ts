import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { backendFetch, errorStatusFromMessage } from '@/lib/api';
import { ADMIN_SESSION_COOKIE } from '@/lib/constants';

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
    const data = await backendFetch('/admin/users', {
      headers: { Authorization: `Bearer ${token}` },
    });

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to load users';

    return NextResponse.json(
      { message },
      { status: errorStatusFromMessage(message) },
    );
  }
}

export async function POST(request: Request) {
  const token = await getAdminToken();

  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  try {
    const data = await backendFetch('/admin/users', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to create user';

    return NextResponse.json(
      { message },
      { status: errorStatusFromMessage(message) },
    );
  }
}
