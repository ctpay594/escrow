import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getUserProfile } from '@/lib/auth';
import { CTPayLogo } from '@/components/ctpay-logo';
import { LoginForm } from './login-form';
import {
  GlassCard,
  GlassCardContent,
  GlassCardHeader,
} from '@/components/ui/glass-card';
import { Skeleton } from '@/components/ui/skeleton';
import { glassAppBackground } from '@/lib/glass-styles';
import { cn } from '@/lib/utils';

export default async function LoginPage() {
  const profile = await getUserProfile();

  if (profile) {
    redirect('/');
  }

  return (
    <div
      className={cn(
        glassAppBackground(),
        'relative flex min-h-full flex-1 flex-col items-center justify-center px-4 py-12',
      )}
    >
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Business payments platform
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
            Secure payouts. Fast settlement.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Real-time settlement for your merchant treasury.
          </p>
        </div>

        <GlassCard className="shadow-[0_12px_48px_rgba(15,23,42,0.08)]">
          <GlassCardHeader className="items-center pb-2 pt-6">
            <CTPayLogo />
          </GlassCardHeader>
          <GlassCardContent className="pb-6">
            <Suspense
              fallback={
                <div className="space-y-4">
                  <Skeleton className="h-11 w-full" />
                  <Skeleton className="h-11 w-full" />
                  <Skeleton className="h-11 w-full" />
                </div>
              }
            >
              <LoginForm />
            </Suspense>
          </GlassCardContent>
        </GlassCard>
      </div>
    </div>
  );
}
