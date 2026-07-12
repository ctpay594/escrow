'use client';

import { motion } from 'framer-motion';
import { AdminHeader } from '@/components/layout/admin-header';
import { SessionTimeoutWarning } from '@/components/session-timeout-warning';
import { glassAppBackground } from '@/lib/glass-styles';
import { cn } from '@/lib/utils';

interface AdminShellProps {
  adminUsername: string;
  activePath: string;
  children: React.ReactNode;
}

export function AdminShell({
  adminUsername,
  activePath,
  children,
}: AdminShellProps) {
  return (
    <div className={cn('flex min-h-full flex-1 flex-col', glassAppBackground())}>
      <AdminHeader adminUsername={adminUsername} activePath={activePath} />
      <motion.main
        key={activePath}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8"
      >
        {children}
      </motion.main>
      <SessionTimeoutWarning />
    </div>
  );
}
