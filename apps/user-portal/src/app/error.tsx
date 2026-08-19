'use client';

import { useEffect } from 'react';
import { ErrorCard } from '@/components/shared/page-header';

export default function UserPortalError({
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
    <div className="flex min-h-full flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <ErrorCard
          title="This page could not load"
          message={
            error.message?.includes('Cannot reach')
              ? 'The API at api.ctpay.tech did not answer in time. You are still signed in — reload in a moment.'
              : 'A server error occurred. Reload to try again. You are still signed in.'
          }
          onRetry={reset}
        />
      </div>
    </div>
  );
}
