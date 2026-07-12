import { NextResponse } from 'next/server';
import { getUserProfile } from '@/lib/auth';

export async function GET() {
  const profile = await getUserProfile();

  if (!profile) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(profile);
}
