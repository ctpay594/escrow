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

const IST = 'Asia/Kolkata';

function istYmd(iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function shiftYmd(ymd: string, days: number) {
  const [year, month, day] = ymd.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

function formatDayHeading(ymd: string, todayYmd: string) {
  if (ymd === todayYmd) {
    return 'Today';
  }

  if (ymd === shiftYmd(todayYmd, -1)) {
    return 'Yesterday';
  }

  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 6, 30)).toLocaleDateString(
    'en-IN',
    { weekday: 'short', day: 'numeric', month: 'short' },
  );
}

function mondayOfIstWeek(todayYmd: string) {
  const weekday = new Date(`${todayYmd}T12:00:00+05:30`).getDay();
  const daysFromMonday = (weekday + 6) % 7;
  return shiftYmd(todayYmd, -daysFromMonday);
}

function VolumeRow({
  label,
  bucket,
  emphasize,
}: {
  label: string;
  bucket: VolumeBucket;
  emphasize?: boolean;
}) {
  const net = bucket.inAmount - bucket.outAmount;

  return (
    <tr className={emphasize ? 'font-medium' : undefined}>
      <td className="py-2 pr-3 align-top">{label}</td>
      <td className="py-2 pr-3 align-top tabular-nums text-emerald-700">
        +{formatCurrency(bucket.inAmount)}
        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
          {bucket.inCount} txn{bucket.inCount === 1 ? '' : 's'}
        </span>
      </td>
      <td className="py-2 pr-3 align-top tabular-nums text-red-600">
        −{formatCurrency(bucket.outAmount)}
        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
          {bucket.outCount} txn{bucket.outCount === 1 ? '' : 's'}
        </span>
      </td>
      <td className="py-2 align-top tabular-nums">
        {net >= 0 ? '+' : '−'}
        {formatCurrency(Math.abs(net))}
      </td>
    </tr>
  );
}

interface VolumeBucket {
  inAmount: number;
  inCount: number;
  outAmount: number;
  outCount: number;
}

function emptyBucket(): VolumeBucket {
  return { inAmount: 0, inCount: 0, outAmount: 0, outCount: 0 };
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
        fetch('/api/auth/me', { cache: 'no-store', credentials: 'include' }),
        fetch('/api/transfers/reconcile-status', {
          method: 'POST',
          credentials: 'include',
        }),
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
    const todayYmd = istYmd(new Date().toISOString());
    const weekStart = mondayOfIstWeek(todayYmd);
    const dayKeys = [0, 1, 2, 3].map((offset) => shiftYmd(todayYmd, -offset));
    const byDay = new Map<string, VolumeBucket>(
      dayKeys.map((key) => [key, emptyBucket()]),
    );
    const week = emptyBucket();

    for (const row of transfers) {
      const day = istYmd(row.created_at);
      const isDeposit = row.kind === 'deposit';
      const isPaidOut =
        !isDeposit && row.status === 'SUCCESS';

      if (!isDeposit && !isPaidOut) {
        continue;
      }

      const apply = (bucket: VolumeBucket) => {
        if (isDeposit) {
          bucket.inAmount += row.amount;
          bucket.inCount += 1;
        } else {
          bucket.outAmount += row.amount;
          bucket.outCount += 1;
        }
      };

      const dayBucket = byDay.get(day);
      if (dayBucket) {
        apply(dayBucket);
      }

      if (day >= weekStart && day <= todayYmd) {
        apply(week);
      }
    }

    const awaitingApproval = transfers.filter(
      (t) => t.status === 'PENDING_APPROVAL',
    ).length;
    const inProgress = transfers.filter((t) => t.status === 'PROCESSING').length;

    return {
      todayYmd,
      awaitingApproval,
      inProgress,
      days: dayKeys.map((key) => ({
        key,
        label: formatDayHeading(key, todayYmd),
        ...byDay.get(key)!,
      })),
      week,
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
                This week
              </p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {formatCurrency(snapshot.week.outAmount)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                out · in {formatCurrency(snapshot.week.inAmount)}
              </p>
            </div>
          </div>

          <div className="border-t border-white/50 pt-4">
            <p className="mb-3 text-sm font-medium text-foreground">
              In and out
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[20rem] text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Day</th>
                    <th className="pb-2 pr-3 font-medium">Incoming</th>
                    <th className="pb-2 pr-3 font-medium">Outgoing</th>
                    <th className="pb-2 font-medium">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.days.map((day) => (
                    <VolumeRow
                      key={day.key}
                      label={day.label}
                      bucket={day}
                      emphasize={day.key === snapshot.todayYmd}
                    />
                  ))}
                  <VolumeRow
                    label="This week"
                    bucket={snapshot.week}
                    emphasize
                  />
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Incoming is deposits. Outgoing is successful payouts. Days use
              India time.
            </p>
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
