'use client';

import Link from 'next/link';
import { History, Layers, RefreshCw, Send } from 'lucide-react';
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
import { formatCurrency, formatTableDate } from '@/lib/format';
import { glassInset } from '@/lib/glass-styles';
import type { DepositItem, MerchantProfile, SessionUser, TransferItem } from '@/lib/types';
import { depositToHistoryRow } from '@/lib/deposit-display';
import {
  aggregateBatchStatus,
  batchDisplayTitle,
  buildHistoryEntries,
  parseUserTransfersResponse,
  type TransferBatchMeta,
} from '@/lib/history-display';
import { cn } from '@/lib/utils';
import { TransferStatusBadge } from '@/components/shared/transfer-status-badge';

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
  const [batchMeta, setBatchMeta] = useState<Map<string, TransferBatchMeta>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [refreshingBalance, setRefreshingBalance] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const loadTransfers = useCallback(async () => {
    setError(null);
    try {
      const [transfersResponse, depositsResponse] = await Promise.all([
        fetch('/api/transfers'),
        fetch('/api/deposits'),
      ]);
      const transfersData = await transfersResponse.json();
      const depositsData = await depositsResponse.json();
      if (transfersResponse.status === 401 || depositsResponse.status === 401) {
        window.location.href = '/api/auth/logout?redirect=/login';
        return;
      }
      if (!transfersResponse.ok) {
        throw new Error(transfersData.message ?? 'Failed to load activity');
      }
      const parsed = parseUserTransfersResponse(transfersData);
      setBatchMeta(parsed.batches);
      const payouts = parsed.transfers.map((row: TransferItem) => ({
        ...row,
        kind: row.kind ?? 'payout',
      }));
      const deposits = (
        depositsResponse.ok && Array.isArray(depositsData)
          ? (depositsData as DepositItem[])
          : []
      ).map(depositToHistoryRow);
      setTransfers(
        [...payouts, ...deposits].sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
      );
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

    const paidOutToday = transfers
      .filter(
        (t) =>
          t.kind !== 'deposit' &&
          t.status === 'SUCCESS' &&
          isToday(t.created_at),
      )
      .reduce((sum, t) => sum + t.amount, 0);

    const collectedToday = transfers
      .filter((t) => t.kind === 'deposit' && isToday(t.created_at))
      .reduce((sum, t) => sum + t.amount, 0);

    const awaitingApproval = transfers.filter(
      (t) => t.status === 'PENDING_APPROVAL',
    ).length;

    const inProgress = transfers.filter((t) => t.status === 'PROCESSING').length;

    const completedThisWeek = transfers.filter(
      (t) =>
        t.kind !== 'deposit' &&
        t.status === 'SUCCESS' &&
        new Date(t.created_at).getTime() >= weekAgo,
    ).length;

    return {
      paidOutToday,
      collectedToday,
      awaitingApproval,
      inProgress,
      completedThisWeek,
    };
  }, [transfers]);

  const recentActivity = useMemo(
    () => buildHistoryEntries(transfers, batchMeta).slice(0, 5),
    [transfers, batchMeta],
  );

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
                  {snapshot.awaitingApproval + snapshot.inProgress} processing
                </p>
              ) : null}
            </div>
            <div className={cn(glassInset(), 'px-4 py-3')}>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Paid out today
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatCurrency(snapshot.paidOutToday)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {snapshot.completedThisWeek} payout{snapshot.completedThisWeek === 1 ? '' : 's'} this week
                {snapshot.collectedToday > 0
                  ? ` · collected ${formatCurrency(snapshot.collectedToday)}`
                  : ''}
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

          <div className="border-t border-white/50 pt-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground">Recent activity</p>
              {recentActivity.length > 0 ? (
                <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs">
                  <Link href="/history">View all</Link>
                </Button>
              ) : null}
            </div>
              {recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Deposits and payouts will show up here.
              </p>
            ) : (
              <ul className="divide-y divide-white/50">
                {recentActivity.map((entry) => {
                  const isBatch = entry.kind === 'batch';
                  const isDeposit = entry.kind === 'deposit';
                  const transfer = entry.kind === 'batch' ? null : entry.item;
                  const createdAt =
                    entry.kind === 'batch' ? entry.created_at : entry.item.created_at;
                  const amount =
                    entry.kind === 'batch'
                      ? entry.totalAmount
                      : entry.item.amount;
                  const status =
                    entry.kind === 'batch'
                      ? aggregateBatchStatus(entry.transfers)
                      : entry.item.status;

                  return (
                    <li key={isBatch ? entry.batchId : entry.item.id}>
                      <Link
                        href="/history"
                        className="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:text-foreground"
                      >
                        <div className="min-w-0">
                          <p className="flex items-center gap-2 truncate font-medium">
                            {isBatch ? (
                              <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            ) : null}
                            <span className="truncate">
                              {isBatch
                                ? batchDisplayTitle(entry)
                                : isDeposit
                                  ? `Deposit · ${transfer?.beneficiary_account_name}`
                                  : transfer?.beneficiary_account_name}
                            </span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatTableDate(createdAt)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span
                            className={cn(
                              'tabular-nums font-medium',
                              isDeposit && 'text-emerald-700',
                            )}
                          >
                            {isDeposit ? '+' : '−'}
                            {formatCurrency(amount)}
                          </span>
                          <TransferStatusBadge status={status} />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
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
