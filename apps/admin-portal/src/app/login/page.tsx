import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AdminLogo } from '@/components/admin-logo';
import {
  GlassCard,
  GlassCardContent,
  GlassCardDescription,
  GlassCardHeader,
  GlassCardTitle,
} from '@/components/ui/glass-card';
import { Skeleton } from '@/components/ui/skeleton';
import { getAdminSession } from '@/lib/auth';
import { glassAppBackground } from '@/lib/glass-styles';
import { cn } from '@/lib/utils';
import { AdminLoginForm } from './admin-login-form';

export default async function AdminLoginPage() {
  let admin = null;

  try {
    admin = await getAdminSession();
  } catch {
    admin = null;
  }

  if (admin) {
    redirect('/');
  }

  return (
    <div
      className={cn(
        'flex min-h-full flex-1 items-center justify-center px-4 py-12',
        glassAppBackground(),
      )}
    >
      <GlassCard className="w-full max-w-md shadow-[0_12px_48px_rgba(15,23,42,0.08)]">
        <GlassCardHeader className="items-center text-center">
          <AdminLogo />
          <GlassCardTitle className="mt-4 text-2xl">Admin sign in</GlassCardTitle>
          <GlassCardDescription>
            Manage merchants and approve transfers per merchant.
          </GlassCardDescription>
        </GlassCardHeader>
        <GlassCardContent>
          <Suspense fallback={<Skeleton className="h-32 w-full" />}>
            <AdminLoginForm />
          </Suspense>
        </GlassCardContent>
      </GlassCard>
    </div>
  );
}
