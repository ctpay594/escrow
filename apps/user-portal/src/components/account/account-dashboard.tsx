'use client';

import Link from 'next/link';
import { History, RefreshCw, Send } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AccountStatusBadge,
  canMerchantTransfer,
} from '@/components/account-status-banner';
import { CopyField } from '@/components/shared/copy-field';
import { ErrorCard, PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import {
  GlassCard,
  GlassCardContent,
} from '@/components/ui/glass-card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/lib/format';
import { glassInset } from '@/lib/glass-styles';
import type { MerchantProfile, SessionUser, TransferItem } from '@/lib/types';
import { cn } from '@/lib/utils';

interface AccountDashboardProps {
  user: SessionUser;
  merchant: MerchantProfile;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

function isToday(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

export function AccountDashboard({
  user,
  merchant: initialMerchant,
}: AccountDashboardProps) {
  const [merchant, setMerchant] = useState(initialMerchant);
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingBalance, setRefreshingBalance] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const loadTransfers = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch('/api/transfers');
      const data = await response.json();
      if (response.status === 401) {
        window.location.href = '/api/auth/logout?redirect=/login';
        return;
      }
      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to load activity');
      }
      setTransfers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTransfers();
  }, [loadTransfers]);

  async function refreshBalance() {
    setRefreshingBalance(true);
    setError(null);

    try {
      const [profileResponse] = await Promise.all([
        fetch('/api/auth/me', { cache: 'no-store' }),
        fetch('/api/transfers/reconcile-status', { method: 'POST' }),
      ]);

      const profileData = await profileResponse.json();

      if (profileResponse.status === 401) {
        window.location.href = '/api/auth/logout?redirect=/login';
        return;
      }

      if (!profileResponse.ok) {
        throw new Error(profileData.message ?? 'Failed to refresh balance');
      }

      if (profileData.merchant) {
        setMerchant(profileData.merchant);
      }

      await loadTransfers();
      setLastRefreshedAt(new Date());
      toast.success('Balance updated');
    } catch (refreshError) {
      toast.error(
        refreshError instanceof Error
          ? refreshError.message
          : 'Failed to refresh balance',
      );
    } finally {
      setRefreshingBalance(false);
    }
  }

  const transfersEnabled = canMerchantTransfer(merchant.account_status);

  const snapshot = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const settledToday = transfers
      .filter((t) => t.status === 'SUCCESS' && isToday(t.created_at))
      .reduce((sum, t) => sum + t.amount, 0);

    const awaitingApproval = transfers.filter(
      (t) => t.status === 'PENDING_APPROVAL',
    ).length;

    const inProgress = transfers.filter((t) => t.status === 'PROCESSING').length;

    const completedThisWeek = transfers.filter(
      (t) =>
        t.status === 'SUCCESS' &&
        new Date(t.created_at).getTime() >= weekAgo,
    ).length;

    return {
      settledToday,
      awaitingApproval,
      inProgress,
      completedThisWeek,
    };
  }, [transfers]);

  if (loading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={merchant.merchant_name}
        description={user.username}
        action={
          <Button
            variant="outline"
            size="sm"
            className="w-full sm:w-auto"
            disabled={refreshingBalance}
            onClick={() => void refreshBalance()}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${refreshingBalance ? 'animate-spin' : ''}`}
            />
            {refreshingBalance ? 'Updating…' : 'Refresh balance'}
          </Button>
        }
      />

      {error ? (
        <ErrorCard
          message={error}
          onRetry={() => {
            setLoading(true);
            void loadTransfers();
          }}
        />
      ) : null}

      <GlassCard>
        <GlassCardContent className="space-y-5 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <AccountStatusBadge status={merchant.account_status ?? 'active'} />
            {lastRefreshedAt ? (
              <span className="text-xs text-muted-foreground">
                Updated{' '}
                {lastRefreshedAt.toLocaleTimeString('en-IN', {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className={cn(glassInset(), 'px-4 py-3')}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Available
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">
                {formatCurrency(merchant.available_balance)}
              </p>
            </div>
            <div className={cn(glassInset(), 'px-4 py-3')}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pending
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatCurrency(merchant.pending_balance)}
              </p>
              {snapshot.awaitingApproval + snapshot.inProgress > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {snapshot.awaitingApproval > 0
                    ? `${snapshot.awaitingApproval} awaiting approval`
                    : null}
                  {snapshot.awaitingApproval > 0 && snapshot.inProgress > 0
                    ? ' · '
                    : null}
                  {snapshot.inProgress > 0
                    ? `${snapshot.inProgress} processing`
                    : null}
                </p>
              ) : null}
            </div>
            <div className={cn(glassInset(), 'px-4 py-3')}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Settled today
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatCurrency(snapshot.settledToday)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {snapshot.completedThisWeek} completed this week
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-white/50 pt-4">
            {transfersEnabled ? (
              <Button asChild size="sm" className="w-full sm:w-auto">
                <Link href="/transfer">
                  <Send className="mr-2 h-4 w-4" />
                  Transfer
                </Link>
              </Button>
            ) : (
              <Button size="sm" className="w-full sm:w-auto" disabled>
                <Send className="mr-2 h-4 w-4" />
                Transfer unavailable
              </Button>
            )}
            <Button asChild size="sm" variant="outline" className="w-full sm:w-auto">
              <Link href="/history">
                <History className="mr-2 h-4 w-4" />
                History
              </Link>
            </Button>
          </div>

          <div className="grid gap-4 border-t border-white/50 pt-4 sm:grid-cols-2">
            <CopyField
              label="Load account"
              value={merchant.virtual_account_no ?? '—'}
            />
            <CopyField label="IFSC" value={merchant.escrow_ifsc ?? '—'} />
          </div>

          <div className={cn(glassInset(), 'px-4 py-3 text-sm text-muted-foreground')}>
            <p className="font-medium text-foreground">How to load funds</p>
            <p className="mt-1.5 leading-relaxed">
              Send NEFT, RTGS, or IMPS to the account above from a whitelisted
              account in your registered name.
            </p>
          </div>
        </GlassCardContent>
      </GlassCard>
    </div>
  );
}
