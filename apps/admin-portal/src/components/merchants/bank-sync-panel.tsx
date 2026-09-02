'use client';

import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  GlassCard,
  GlassCardContent,
  GlassCardHeader,
  GlassCardTitle,
} from '@/components/ui/glass-card';
import { cn } from '@/lib/utils';

interface BankSyncStatus {
  last_synced_date: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  unread_notifications: number;
  is_running: boolean;
}

interface BankSyncRun {
  id: string;
  sync_date: string;
  trigger_type: 'cron' | 'manual';
  status: string;
  credit_lines: number;
  deposits_added: number;
  deposits_skipped: number;
  unmatched_credits: number;
  started_at: string;
  completed_at?: string | null;
  error_message?: string | null;
}

interface BankSyncNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

function formatIstDate(value: string | null): string {
  if (!value) {
    return '—';
  }

  return value;
}

function formatWhen(iso: string | null): string {
  if (!iso) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));
}

function redirectToLoginIfUnauthorized(response: Response): boolean {
  if (response.status === 401) {
    window.location.href = '/api/auth/logout?redirect=/login';
    return true;
  }

  return false;
}

export function BankSyncPanel({ onDepositsAdded }: { onDepositsAdded?: () => void }) {
  const [status, setStatus] = useState<BankSyncStatus | null>(null);
  const [runs, setRuns] = useState<BankSyncRun[]>([]);
  const [notifications, setNotifications] = useState<BankSyncNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setError(null);

    try {
      const [statusRes, runsRes, notificationsRes] = await Promise.all([
        fetch('/api/bank-sync/status', { cache: 'no-store' }),
        fetch('/api/bank-sync/runs', { cache: 'no-store' }),
        fetch('/api/bank-sync/notifications', { cache: 'no-store' }),
      ]);

      if (
        redirectToLoginIfUnauthorized(statusRes) ||
        redirectToLoginIfUnauthorized(runsRes) ||
        redirectToLoginIfUnauthorized(notificationsRes)
      ) {
        return;
      }

      const [statusData, runsData, notificationsData] = await Promise.all([
        statusRes.json(),
        runsRes.json(),
        notificationsRes.json(),
      ]);

      if (!statusRes.ok) {
        throw new Error(statusData.message ?? 'Failed to load bank sync status');
      }

      setStatus(statusData as BankSyncStatus);
      setRuns(Array.isArray(runsData) ? runsData : []);
      setNotifications(Array.isArray(notificationsData) ? notificationsData : []);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load bank sync data',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function runManualSync() {
    setSyncing(true);

    try {
      const response = await fetch('/api/bank-sync/run', { method: 'POST' });
      const data = await response.json().catch(() => ({}));

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(
          typeof data.message === 'string'
            ? data.message
            : 'HDFC statement sync failed',
        );
      }

      const results = Array.isArray(data) ? data : [];
      const added = results.reduce(
        (sum: number, row: { deposits_added?: number }) =>
          sum + Number(row.deposits_added ?? 0),
        0,
      );
      const unmatched = results.reduce(
        (sum: number, row: { unmatched_credits?: number }) =>
          sum + Number(row.unmatched_credits ?? 0),
        0,
      );

      if (added > 0) {
        toast.success(
          `Synced with HDFC · ${added} missed deposit${added === 1 ? '' : 's'} credited`,
        );
        onDepositsAdded?.();
      } else if (unmatched > 0) {
        toast.message(`Synced · ${unmatched} credit line(s) need review`);
      } else {
        toast.success('Synced with HDFC · nothing missing');
      }

      await loadAll();
    } catch (syncError) {
      toast.error(
        syncError instanceof Error
          ? syncError.message
          : 'HDFC statement sync failed',
      );
    } finally {
      setSyncing(false);
    }
  }

  async function markAllRead() {
    try {
      const response = await fetch('/api/bank-sync/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message ?? 'Failed to mark notifications read');
      }

      await loadAll();
    } catch (readError) {
      toast.error(
        readError instanceof Error
          ? readError.message
          : 'Failed to mark notifications read',
      );
    }
  }

  const unread = status?.unread_notifications ?? 0;
  const isBusy = syncing || status?.is_running;

  return (
    <GlassCard>
      <GlassCardHeader className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <GlassCardTitle className="text-sm font-medium">
              HDFC statement sync
            </GlassCardTitle>
            {unread > 0 ? (
              <Badge variant="warning" className="text-[10px]">
                {unread} alert{unread === 1 ? '' : 's'}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Nightly at 12:00 AM IST · matches deposits by UTR · skips bank
            charges
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || isBusy}
            onClick={() => void loadAll()}
          >
            <RefreshCw
              className={cn('mr-2 h-4 w-4', loading && 'animate-spin')}
            />
            Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={loading || isBusy}
            onClick={() => void runManualSync()}
          >
            {isBusy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Sync with HDFC
          </Button>
        </div>
      </GlassCardHeader>

      <GlassCardContent className="space-y-5 border-t border-white/50 px-5 py-4">
        {error ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {error}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Last synced day
              </p>
              <p className="mt-1 font-semibold tabular-nums text-slate-900">
                {loading ? '—' : formatIstDate(status?.last_synced_date ?? null)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Last run
              </p>
              <p className="mt-1 text-sm text-slate-800">
                {loading ? '—' : formatWhen(status?.last_run_at ?? null)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Last run status
              </p>
              <p className="mt-1 text-sm capitalize text-slate-800">
                {loading ? '—' : status?.last_run_status ?? '—'}
              </p>
            </div>
          </div>
        )}

        {notifications.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Alerts
              </p>
              {unread > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => void markAllRead()}
                >
                  Mark all read
                </Button>
              ) : null}
            </div>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 bg-white/50">
              {notifications.slice(0, 8).map((item) => (
                <li key={item.id} className="flex gap-3 px-3 py-2.5 text-sm">
                  {item.kind === 'bank_sync_failed' ? (
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  ) : (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'font-medium text-slate-900',
                        !item.read_at && 'text-amber-950',
                      )}
                    >
                      {item.title}
                    </p>
                    <p className="text-xs text-muted-foreground">{item.body}</p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {formatWhen(item.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {runs.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Recent runs
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-100">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50/80 text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Trigger</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Added</th>
                    <th className="px-3 py-2 text-right">Skipped</th>
                    <th className="px-3 py-2 text-right">Unmatched</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white/40">
                  {runs.slice(0, 5).map((run) => (
                    <tr key={run.id}>
                      <td className="px-3 py-2 tabular-nums">{run.sync_date}</td>
                      <td className="px-3 py-2 capitalize">{run.trigger_type}</td>
                      <td className="px-3 py-2 capitalize">{run.status}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {run.deposits_added}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {run.deposits_skipped}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {run.unmatched_credits}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {runs.some((run) => run.deposits_added > 0) ? (
              <p className="text-[11px] text-muted-foreground">
                Added amounts appear in merchant deposit history only — bank
                charges are never imported.
              </p>
            ) : null}
          </div>
        ) : loading ? null : (
          <p className="text-sm text-muted-foreground">
            No statement sync runs yet. Use &quot;Sync with HDFC&quot; to
            backfill missed deposits for today.
          </p>
        )}

        {isBusy ? (
          <p className="text-xs text-muted-foreground">
            Checking HDFC statement — usually a few seconds. If not ready, try again later.
          </p>
        ) : null}
      </GlassCardContent>
    </GlassCard>
  );
}
