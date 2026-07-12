import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { backendFetch } from '@/lib/api';
import { SESSION_COOKIE } from '@/lib/constants';

async function getUserToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}

export async function POST(request: Request) {
  const token = await getUserToken();

  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();

  try {
    const data = await backendFetch('/transfers/bulk', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to submit bulk transfer';

    const status =
      message.toLowerCase().includes('insufficient') ||
      message.toLowerCase().includes('required') ||
      message.toLowerCase().includes('maximum')
        ? 400
        : 502;

    return NextResponse.json({ message }, { status });
  }
}
