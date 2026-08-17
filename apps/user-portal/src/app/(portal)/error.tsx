'use client';

import { useEffect } from 'react';
import { ErrorCard } from '@/components/shared/page-header';

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="p-4 sm:p-6">
      <ErrorCard
        message={
          error.message?.includes('Cannot reach') ||
          error.message?.includes('Failed to load')
            ? error.message
            : 'Could not load your account. You are still signed in — try again.'
        }
        onRetry={reset}
      />
    </div>
  );
}
