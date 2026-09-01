'use client';

import Link from 'next/link';
import { ArrowLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorCard, PageHeader } from '@/components/shared/page-header';
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
  AnalyticsDailyRow,
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
import { glassTableHead, glassTableRow } from '@/lib/glass-styles';
import { cn } from '@/lib/utils';

type AnalyticsPeriod = Exclude<HistoryPeriodPreset, '48h'> | 'today';

const PERIOD_OPTIONS: { value: AnalyticsPeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom' },
];

function redirectToLoginIfUnauthorized(response: Response): boolean {
  if (response.status === 401) {
    window.location.href = '/api/auth/logout?redirect=/login';
    return true;
  }

  return false;
}

function daysInclusive(from: string, to: string) {
  const days: string[] = [];
  if (!from || !to) {
    return days;
  }

  let current = from <= to ? from : to;
  const end = from <= to ? to : from;

  while (current <= end) {
    days.push(current);
    current = shiftYmd(current, 1);
  }

  return days;
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

function statusDot(status: string) {
  if (status === 'active') {
    return 'bg-emerald-500';
  }
  if (status === 'on_hold') {
    return 'bg-amber-500';
  }
  return 'bg-slate-400';
}

function statusLabel(status: string) {
  if (status === 'on_hold') {
    return 'On hold';
  }
  if (status === 'terminated') {
    return 'Terminated';
  }
  return 'Active';
}

function fillDailyRows(
  rows: AnalyticsDailyRow[],
  from: string,
  to: string,
): AnalyticsDailyRow[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));

  return daysInclusive(from, to)
    .map(
      (date) =>
        byDate.get(date) ?? {
          date,
          in_amount: 0,
          in_count: 0,
          out_success_amount: 0,
          out_success_count: 0,
        },
    )
    .reverse();
}

function Kpi({
  label,
  value,
  sub,
  tone = 'slate',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'slate' | 'in' | 'out';
}) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tracking-tight tabular-nums',
          tone === 'in' && 'text-emerald-800',
          tone === 'out' && 'text-red-700',
        )}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
      ) : null}
    </div>
  );
}

function VolumeTable({
  rows,
  todayYmd,
  caption,
}: {
  rows: AnalyticsDailyRow[];
  todayYmd: string;
  caption: string;
}) {
  const totals = useMemo(
    () =>
      rows.reduce(
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
      ),
    [rows],
  );

  return (
    <GlassCard>
      <GlassCardHeader className="px-5 py-4">
        <GlassCardTitle className="text-sm font-medium">
          {caption}
        </GlassCardTitle>
      </GlassCardHeader>
      <GlassCardContent className="overflow-x-auto px-0 pb-0">
        <table className="w-full min-w-[480px] text-sm">
          <thead className={glassTableHead()}>
            <tr>
              <th className="px-5 py-3 text-left font-medium">Day</th>
              <th className="px-3 py-3 text-right font-medium">In</th>
              <th className="px-3 py-3 text-right font-medium">Out</th>
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
                  No activity in this range.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const net = row.in_amount - row.out_success_amount;
                const idle = row.in_count === 0 && row.out_success_count === 0;

                return (
                  <tr
                    key={row.date}
                    className={cn(glassTableRow(), idle && 'text-muted-foreground')}
                  >
                    <td className="px-5 py-2.5">
                      {formatDayHeading(row.date, todayYmd)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">
                      {idle ? '—' : `+${formatCurrency(row.in_amount)}`}
                      {row.in_count > 0 ? (
                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                          {row.in_count}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-red-600">
                      {idle ? '—' : `−${formatCurrency(row.out_success_amount)}`}
                      {row.out_success_count > 0 ? (
                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                          {row.out_success_count}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {idle
                        ? '—'
                        : `${net >= 0 ? '+' : '−'}${formatCurrency(Math.abs(net))}`}
                    </td>
                  </tr>
                );
              })
            )}
            {rows.length > 0 ? (
              <tr className="border-t border-border/70 bg-slate-50/70 font-medium">
                <td className="px-5 py-3">Total</td>
                <td className="px-3 py-3 text-right tabular-nums text-emerald-700">
                  +{formatCurrency(totals.in_amount)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-red-600">
                  −{formatCurrency(totals.out_success_amount)}
                </td>
                <td className="px-5 py-3 text-right tabular-nums">
                  {totals.in_amount - totals.out_success_amount >= 0 ? '+' : '−'}
                  {formatCurrency(
                    Math.abs(totals.in_amount - totals.out_success_amount),
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

export function AdminAnalyticsPanel() {
  const todayYmd = todayYmdIst();
  const [period, setPeriod] = useState<AnalyticsPeriod>('all');
  const [customFrom, setCustomFrom] = useState(() => defaultCustomRange().from);
  const [customTo, setCustomTo] = useState(() => defaultCustomRange().to);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [overview, setOverview] = useState<AdminAnalyticsResponse | null>(null);
  const [merchantView, setMerchantView] =
    useState<AdminAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rangeParams = useMemo(() => {
    if (period === 'today') {
      return { from: todayYmd, to: todayYmd };
    }
    if (period === 'custom') {
      return { from: customFrom, to: customTo };
    }
    if (period === 'all') {
      return null;
    }
    return rangeForPreset(period);
  }, [customFrom, customTo, period, todayYmd]);

  const periodQuery = useMemo(() => {
    if (!rangeParams) {
      return '';
    }
    const params = new URLSearchParams();
    params.set('from', rangeParams.from);
    params.set('to', rangeParams.to);
    return `?${params.toString()}`;
  }, [rangeParams]);

  const loadOverview = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const response = await fetch(`/api/analytics${periodQuery}`, {
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

      setOverview(payload as AdminAnalyticsResponse);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load analytics',
      );
    } finally {
      setLoading(false);
    }
  }, [periodQuery]);

  const loadMerchant = useCallback(async (userId: string) => {
    const params = new URLSearchParams();
    params.set('user_id', userId);
    if (rangeParams) {
      params.set('from', rangeParams.from);
      params.set('to', rangeParams.to);
    }

    const response = await fetch(`/api/analytics?${params.toString()}`, {
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
          : 'Failed to load merchant analytics',
      );
    }

    setMerchantView(payload as AdminAnalyticsResponse);
  }, [rangeParams]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    if (!selectedUserId) {
      setMerchantView(null);
      return;
    }

    void loadMerchant(selectedUserId).catch((loadError: unknown) => {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load merchant analytics',
      );
    });
  }, [loadMerchant, selectedUserId]);

  const selectedMerchant = useMemo(() => {
    if (!selectedUserId) {
      return null;
    }

    return (
      merchantView?.merchants[0] ??
      overview?.merchants.find((row) => row.user_id === selectedUserId) ??
      null
    );
  }, [merchantView?.merchants, overview?.merchants, selectedUserId]);

  const periodLabel =
    period === 'today'
      ? 'Today'
      : historyPeriodLabel(
          period === 'custom' ? 'custom' : period,
          customFrom,
          customTo,
        );

  const bucket: AnalyticsVolumeBucket | undefined = selectedMerchant
    ? selectedMerchant.period
    : overview?.summary;

  const dailyCaption = selectedMerchant
    ? `Daily · ${periodLabel}`
    : period === 'all'
      ? 'Last 14 days'
      : `Daily · ${periodLabel}`;

  const dailyRows = useMemo(() => {
    const source = selectedMerchant ? merchantView : overview;
    if (!source) {
      return [];
    }

    if (period === 'all') {
      return fillDailyRows(
        source.daily,
        shiftYmd(todayYmd, -13),
        todayYmd,
      );
    }

    const from = rangeParams?.from ?? source.period.from;
    const to = rangeParams?.to ?? source.period.to;
    return fillDailyRows(source.daily, from, to);
  }, [merchantView, overview, period, rangeParams, selectedMerchant, todayYmd]);

  if (loading && !overview) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const failed = bucket?.out_failed_amount ?? 0;
  const pending = bucket?.out_pending_amount ?? 0;
  const failedCount = bucket?.out_failed_count ?? 0;
  const pendingCount = bucket?.out_pending_count ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={selectedMerchant ? selectedMerchant.merchant_name : 'Analytics'}
        description={
          selectedMerchant
            ? selectedMerchant.username
            : 'Deposits in and successful payouts out. India time.'
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            {selectedMerchant ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedUserId(null)}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  All merchants
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/merchants/${selectedMerchant.user_id}`}>
                    Open account
                  </Link>
                </Button>
              </>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => void loadOverview()}>
              <RefreshCw
                className={cn('mr-2 h-4 w-4', loading && 'animate-spin')}
              />
              Refresh
            </Button>
          </div>
        }
      />

      {error ? (
        <ErrorCard message={error} onRetry={() => void loadOverview()} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {PERIOD_OPTIONS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant={period === option.value ? 'default' : 'outline'}
            onClick={() => setPeriod(option.value)}
          >
            {option.label}
          </Button>
        ))}
        {period === 'custom' ? (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
              className="h-8 w-[150px]"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
              className="h-8 w-[150px]"
            />
          </div>
        ) : null}
      </div>

      {bucket ? (
        <GlassCard>
          <GlassCardContent className="grid gap-6 p-5 sm:grid-cols-2 lg:grid-cols-3">
            <Kpi
              label="In"
              value={formatCurrency(bucket.in_amount)}
              sub={`${bucket.in_count} deposits · ${periodLabel}`}
              tone="in"
            />
            <Kpi
              label="Out"
              value={formatCurrency(bucket.out_success_amount)}
              sub={`${bucket.out_success_count} successful payouts`}
              tone="out"
            />
            <div className="flex flex-col justify-end gap-2">
              {failed > 0 ? (
                <p className="text-sm text-amber-900">
                  Failed / rejected {formatCurrency(failed)}
                  <span className="text-muted-foreground"> · {failedCount}</span>
                </p>
              ) : null}
              {pending > 0 ? (
                <p className="text-sm text-slate-700">
                  In pipeline {formatCurrency(pending)}
                  <span className="text-muted-foreground"> · {pendingCount}</span>
                </p>
              ) : null}
              {failed === 0 && pending === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No failed or pending payouts in this period
                </p>
              ) : null}
            </div>
          </GlassCardContent>
        </GlassCard>
      ) : null}

      {!selectedMerchant ? (
        <GlassCard>
          <GlassCardHeader className="px-5 py-4">
            <GlassCardTitle className="text-sm font-medium">
              By merchant
            </GlassCardTitle>
            <p className="text-xs text-muted-foreground">
              Volume for {periodLabel}. Available is live ledger.
            </p>
          </GlassCardHeader>
          <GlassCardContent className="overflow-x-auto px-0 pb-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead className={glassTableHead()}>
                <tr>
                  <th className="px-5 py-3 text-left font-medium">Merchant</th>
                  <th className="px-3 py-3 text-right font-medium">In</th>
                  <th className="px-3 py-3 text-right font-medium">Out</th>
                  <th className="px-3 py-3 text-right font-medium">Share</th>
                  <th className="px-3 py-3 text-right font-medium">Available</th>
                  <th className="px-5 py-3 text-right font-medium" />
                </tr>
              </thead>
              <tbody>
                {(overview?.merchants ?? []).map((merchant) => {
                  const vol = merchant.period;
                  const share =
                    (overview?.summary.in_amount ?? 0) > 0
                      ? (vol.in_amount / overview!.summary.in_amount) * 100
                      : 0;

                  return (
                    <tr
                      key={merchant.user_id}
                      className={cn(glassTableRow(), 'cursor-pointer')}
                      onClick={() => setSelectedUserId(merchant.user_id)}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              'h-2 w-2 shrink-0 rounded-full',
                              statusDot(merchant.account_status),
                            )}
                            title={statusLabel(merchant.account_status)}
                          />
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {merchant.merchant_name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {merchant.username}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-emerald-800">
                        {formatCurrency(vol.in_amount)}
                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                          {vol.in_count}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-red-700">
                        {formatCurrency(vol.out_success_amount)}
                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                          {vol.out_success_count}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                        {share > 0 ? `${share.toFixed(0)}%` : '—'}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {formatCurrency(merchant.available_balance)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </GlassCardContent>
        </GlassCard>
      ) : null}

      <VolumeTable
        rows={dailyRows}
        todayYmd={todayYmd}
        caption={dailyCaption}
      />
    </div>
  );
}
