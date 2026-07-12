'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorBoundary } from '@/components/error-boundary';
import { PortalShell } from '@/components/portal-shell';
import type { MerchantProfile, SessionUser, TransferItem } from '@/lib/types';

export function PortalLayout({
  children,
  user,
  merchant,
}: {
  children: React.ReactNode;
  user: SessionUser;
  merchant: MerchantProfile | null;
}) {
  const pathname = usePathname();
  const [processingCount, setProcessingCount] = useState(0);

  useEffect(() => {
    void fetch('/api/transfers')
      .then((response) => response.json())
      .then((data: TransferItem[]) => {
        if (!Array.isArray(data)) {
          return;
        }

        setProcessingCount(
          data.filter(
            (transfer) =>
              transfer.status === 'PENDING_APPROVAL' ||
              transfer.status === 'PROCESSING',
          ).length,
        );
      })
      .catch(() => {
        // Optional badge — ignore failures
      });
  }, [pathname]);

  return (
    <ErrorBoundary>
      <PortalShell
        activePath={pathname}
        user={user}
        merchant={merchant}
        processingCount={processingCount}
      >
        {children}
      </PortalShell>
    </ErrorBoundary>
  );
}
