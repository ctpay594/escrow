'use client';

import {
  ArrowLeft,
  BarChart3,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorCard, PageHeader } from '@/components/shared/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  GlassCard,
  GlassCardContent,
  GlassCardHeader,
  GlassCardTitle,
} from '@/components/ui/glass-card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  AdminAnalyticsResponse,
  AnalyticsMerchantRow,
  AnalyticsVolumeBucket,
} from '@/lib/analytics-types';
import {
  defaultCustomRange,
  formatYmdLong,
  historyPeriodLabel,
  rangeForPreset,
  shiftYmd,
  todayYmdIst,
  type HistoryPeriodPreset,
} from '@/lib/history-date-range';
import { formatCurrency } from '@/lib/format';
import { glassInset, glassTableHead, glassTableRow } from '@/lib/glass-styles';
import { cn } from '@/lib/utils';

type AnalyticsPeriod = HistoryPeriodPreset;

function redirectToLoginIfUnauthorized(response: Response): boolean {
  if (response.status === 401) {
    window.location.href = '/api/auth/logout?redirect=/login';
    return true;
  }

  return false;
}

function formatDayHeading(ymd: string, todayYmd: string) {
  if (ymd === todayYmd) {
    return 'Today';
  }

  if (ymd === shiftYmd(todayYmd, -1)) {
    return 'Yesterday';
  }

  return formatYmdLong(ymd);
}

function netAmount(bucket: AnalyticsVolumeBucket) {
  return bucket.in_amount - bucket.out_success_amount;
}

function KpiTile({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'in' | 'out' | 'warn' | 'accent';
}) {
  const toneClass =
    tone === 'in'
      ? 'text-emerald-950'
      : tone === 'out'
        ? 'text-red-700'
        : tone === 'warn'
          ? 'text-amber-900'
          : tone === 'accent'
            ? 'text-slate-900'
            : 'text-slate-900';

  return (
    <div className={cn(glassInset(), 'px-4 py-3')}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={cn('mt-1.5 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl', toneClass)}>
        {value}
      </p>
      {sub ? (
        <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

function VolumeTable({
  rows,
  todayYmd,
  title,
}: {
  rows: AdminAnalyticsResponse['daily'];
  todayYmd: string;
  title: string;
}) {
  const weekTotal = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.in_amount += row.in_amount;
        acc.in_count += row.in_count;
        acc.out_success_amount += row.out_success_amount;
        acc.out_success_count += row.out_success_count;
        return acc;
      },
      {
        in_amount: 0,
        in_count: 0,
        out_success_amount: 0,
        out_success_count: 0,
      },
    );
  }, [rows]);

  return (
    <GlassCard>
      <GlassCardHeader className="px-5 py-4">
        <GlassCardTitle className="text-sm font-medium">{title}</GlassCardTitle>
        <p className="text-xs text-muted-foreground">
          Incoming = deposits. Outgoing = successful payouts. Days use India time.
        </p>
      </GlassCardHeader>
      <GlassCardContent className="overflow-x-auto px-0 pb-0">
        <table className="w-full min-w-[520px] text-sm">
          <thead className={glassTableHead()}>
            <tr>
              <th className="px-5 py-3 text-left font-medium">Day</th>
              <th className="px-3 py-3 text-right font-medium">Incoming</th>
              <th className="px-3 py-3 text-right font-medium">Outgoing</th>
              <th className="px-5 py-3 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-5 py-8 text-center text-sm text-muted-foreground"
                >
                  No activity in this period.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const net = row.in_amount - row.out_success_amount;
                return (
                  <tr key={row.date} className={glassTableRow()}>
                    <td className="px-5 py-3">
                      {formatDayHeading(row.date, todayYmd)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-emerald-700">
                      +{formatCurrency(row.in_amount)}
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                        {row.in_count} txn{row.in_count === 1 ? '' : 's'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-red-600">
                      −{formatCurrency(row.out_success_amount)}
                      <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                        {row.out_success_count} txn
                        {row.out_success_count === 1 ? '' : 's'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {net >= 0 ? '+' : '−'}
                      {formatCurrency(Math.abs(net))}
                    </td>
                  </tr>
                );
              })
            )}
            {rows.length > 0 ? (
              <tr className="border-t border-border/70 bg-slate-50/60 font-medium">
                <td className="px-5 py-3">Period total</td>
                <td className="px-3 py-3 text-right tabular-nums text-emerald-700">
                  +{formatCurrency(weekTotal.in_amount)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-red-600">
                  −{formatCurrency(weekTotal.out_success_amount)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {weekTotal.in_amount - weekTotal.out_success_amount >= 0
                    ? '+'
                    : '−'}
                  {formatCurrency(
                    Math.abs(
                      weekTotal.in_amount - weekTotal.out_success_amount,
                    ),
                  )}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </GlassCardContent>
    </GlassCard>
  );
}

function MerchantCard({
  merchant,
  onSelect,
}: {
  merchant: AnalyticsMerchantRow;
  onSelect: () => void;
}) {
  const lifetimeNet = netAmount(merchant.lifetime);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group w-full rounded-xl border border-border/60 bg-white/70 p-4 text-left transition-all hover:border-slate-300 hover:bg-white hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">
            {merchant.merchant_name}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {merchant.username}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={
              merchant.account_status === 'active' ? 'default' : 'secondary'
            }
            className="shrink-0 capitalize"
          >
            {merchant.account_status.replace('_', ' ')}
          </Badge>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border/50 pt-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Lifetime in
          </p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-emerald-800">
            {formatCurrency(merchant.lifetime.in_amount)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Lifetime out
          </p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-red-700">
            {formatCurrency(merchant.lifetime.out_success_amount)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Available
          </p>
          <p className="mt-1 text-sm font-semibold tabular-nums">
            {formatCurrency(merchant.available_balance)}
          </p>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Net {lifetimeNet >= 0 ? '+' : '−'}
        {formatCurrency(Math.abs(lifetimeNet))} · {merchant.lifetime.in_count}{' '}
        deposits · {merchant.lifetime.out_success_count} payouts
      </p>
    </button>
  );
}

export function AdminAnalyticsPanel() {
  const todayYmd = todayYmdIst();
  const [period, setPeriod] = useState<AnalyticsPeriod>('all');
  const [customFrom, setCustomFrom] = useState(() => defaultCustomRange().from);
  const [customTo, setCustomTo] = useState(() => defaultCustomRange().to);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [data, setData] = useState<AdminAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedUserId) {
      params.set('user_id', selectedUserId);
    }

    if (period === 'custom') {
      params.set('from', customFrom);
      params.set('to', customTo);
    } else if (period !== 'all') {
      const range = rangeForPreset(period);
      if (range) {
        params.set('from', range.from);
        params.set('to', range.to);
      }
    }

    const query = params.toString();
    return query ? `?${query}` : '';
  }, [customFrom, customTo, period, selectedUserId]);

  const loadData = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/analytics${queryString}`, {
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(
          typeof payload.message === 'string'
            ? payload.message
            : 'Failed to load analytics',
        );
      }

      setData(payload as AdminAnalyticsResponse);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load analytics',
      );
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedMerchant = useMemo(
    () => data?.merchants.find((row) => row.user_id === selectedUserId) ?? null,
    [data?.merchants, selectedUserId],
  );

  const periodLabel = historyPeriodLabel(period, customFrom, customTo);
  const summary = data?.summary;
  const activeBucket = selectedMerchant?.period ?? summary;

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description={
          selectedMerchant
            ? `${selectedMerchant.merchant_name} · ${selectedMerchant.username}`
            : 'Platform volume, deposits, and successful payouts across all merchants.'
        }
        action={
          <Button variant="outline" size="sm" onClick={() => void loadData()}>
            <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      {error ? (
        <ErrorCard message={error} onRetry={() => void loadData()} />
      ) : null}

      <GlassCard>
        <GlassCardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {selectedMerchant ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedUserId(null)}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  All merchants
                </Button>
              ) : (
                <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <BarChart3 className="h-4 w-4" />
                  Platform overview
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(['all', '7d', '30d', 'custom'] as const).map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant={period === preset ? 'default' : 'outline'}
                  onClick={() => setPeriod(preset)}
                >
                  {preset === 'all'
                    ? 'All time'
                    : preset === '7d'
                      ? '7 days'
                      : preset === '30d'
                        ? '30 days'
                        : 'Custom'}
                </Button>
              ))}
            </div>
          </div>

          {period === 'custom' ? (
            <div className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50/80 px-3 py-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  From
                </label>
                <Input
                  type="date"
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                  className="w-[160px]"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  To
                </label>
                <Input
                  type="date"
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                  className="w-[160px]"
                />
              </div>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Showing {periodLabel}
            {data?.generated_at
              ? ` · updated ${new Date(data.generated_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`
              : ''}
          </p>
        </GlassCardContent>
      </GlassCard>

      {summary && activeBucket ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            label="Incoming"
            value={formatCurrency(activeBucket.in_amount)}
            sub={`${activeBucket.in_count} deposit${activeBucket.in_count === 1 ? '' : 's'}`}
            tone="in"
          />
          <KpiTile
            label="Outgoing (success)"
            value={formatCurrency(activeBucket.out_success_amount)}
            sub={`${activeBucket.out_success_count} payout${activeBucket.out_success_count === 1 ? '' : 's'}`}
            tone="out"
          />
          <KpiTile
            label="Net flow"
            value={`${netAmount(activeBucket) >= 0 ? '+' : '−'}${formatCurrency(Math.abs(netAmount(activeBucket)))}`}
            sub="Incoming minus successful payouts"
            tone="accent"
          />
          <KpiTile
            label={selectedMerchant ? 'Available balance' : 'Merchants available'}
            value={formatCurrency(
              selectedMerchant
                ? selectedMerchant.available_balance
                : summary.available_balance,
            )}
            sub={
              selectedMerchant
                ? `Pending ${formatCurrency(selectedMerchant.pending_balance)}`
                : `${summary.merchant_count} accounts · pending ${formatCurrency(summary.pending_balance)}`
            }
          />
        </div>
      ) : null}

      {selectedMerchant && activeBucket ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiTile
            label="Failed / rejected"
            value={formatCurrency(activeBucket.out_failed_amount)}
            sub={`${activeBucket.out_failed_count} in period`}
            tone="warn"
          />
          <KpiTile
            label="In pipeline"
            value={formatCurrency(activeBucket.out_pending_amount)}
            sub={`${activeBucket.out_pending_count} awaiting or processing`}
          />
          <KpiTile
            label="Lifetime volume"
            value={formatCurrency(selectedMerchant.lifetime.in_amount)}
            sub={`${formatCurrency(selectedMerchant.lifetime.out_success_amount)} paid out all time`}
          />
        </div>
      ) : null}

      {!selectedMerchant && summary ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <KpiTile
            label="Failed / rejected"
            value={formatCurrency(summary.out_failed_amount)}
            sub={`${summary.out_failed_count} transfers`}
            tone="warn"
          />
          <KpiTile
            label="In pipeline"
            value={formatCurrency(summary.out_pending_amount)}
            sub={`${summary.out_pending_count} awaiting or processing`}
          />
          <KpiTile
            label="Company route (success)"
            value={formatCurrency(summary.company_out_success_amount)}
            sub={`${summary.company_out_success_count} admin transfers`}
          />
        </div>
      ) : null}

      {selectedMerchant ? (
        <VolumeTable
          rows={data?.daily ?? []}
          todayYmd={todayYmd}
          title={`Daily volume · ${periodLabel}`}
        />
      ) : (
        <>
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">
                Merchants
              </h2>
              <p className="text-xs text-muted-foreground">
                Click a merchant for date-range breakdown
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {(data?.merchants ?? []).map((merchant) => (
                <MerchantCard
                  key={merchant.user_id}
                  merchant={merchant}
                  onSelect={() => setSelectedUserId(merchant.user_id)}
                />
              ))}
            </div>
          </div>

          <VolumeTable
            rows={data?.daily ?? []}
            todayYmd={todayYmd}
            title={`Platform daily volume · ${data?.period.scope === 'all_time' ? 'last 30 days' : periodLabel}`}
          />
        </>
      )}
    </div>
  );
}
