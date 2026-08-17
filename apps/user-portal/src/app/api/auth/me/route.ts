import { NextResponse } from 'next/server';
import { BackendRequestError } from '@/lib/api';
import { getUserProfile, getSessionToken } from '@/lib/auth';

export async function GET() {
  const token = await getSessionToken();

  if (!token) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const profile = await getUserProfile();

    if (!profile) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json(profile);
  } catch (error) {
    if (error instanceof BackendRequestError) {
      return NextResponse.json(
        { message: error.message },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { message: 'Failed to load account' },
      { status: 502 },
    );
  }
}
