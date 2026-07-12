'use client';

import { motion } from 'framer-motion';
import { AccountStatusBanner } from '@/components/account-status-banner';
import { PortalHeader } from '@/components/layout/portal-header';
import { SessionTimeoutWarning } from '@/components/session-timeout-warning';
import { glassAppBackground } from '@/lib/glass-styles';
import type { MerchantProfile, SessionUser } from '@/lib/types';
import { cn } from '@/lib/utils';

interface PortalShellProps {
  children: React.ReactNode;
  activePath: string;
  user: SessionUser;
  merchant: MerchantProfile | null;
  processingCount?: number;
}

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

export function PortalShell({
  children,
  activePath,
  user,
  merchant,
  processingCount,
}: PortalShellProps) {
  return (
    <div className={cn('flex min-h-full flex-1 flex-col', glassAppBackground())}>
      <PortalHeader
        activePath={activePath}
        user={user}
        merchant={merchant}
        processingCount={processingCount}
      />
      {merchant ? (
        <AccountStatusBanner status={merchant.account_status ?? 'active'} />
      ) : null}
      <SessionTimeoutWarning />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:px-6 sm:py-6">
        <motion.div
          key={activePath}
          initial="initial"
          animate="animate"
          variants={pageVariants}
          transition={{ duration: 0.25, ease: 'easeOut' }}
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}
