'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
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
  last_run_summary: string | null;
  is_running: boolean;
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
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    setError(null);

    try {
      const response = await fetch('/api/bank-sync/status', { cache: 'no-store' });

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to load bank sync status');
      }

      setStatus(data as BankSyncStatus);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load bank sync status',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

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

      if (added > 0) {
        toast.success(
          `Synced · ${added} missed deposit${added === 1 ? '' : 's'} credited`,
        );
        onDepositsAdded?.();
      } else {
        toast.success('Synced with HDFC');
      }

      await loadStatus();
    } catch (syncError) {
      toast.error(
        syncError instanceof Error
          ? syncError.message
          : 'HDFC statement sync failed',
      );
      await loadStatus();
    } finally {
      setSyncing(false);
    }
  }

  const isBusy = syncing || status?.is_running;
  const failed = status?.last_run_status === 'failed';

  return (
    <GlassCard>
      <GlassCardHeader className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <GlassCardTitle className="text-sm font-medium">
            HDFC statement sync
          </GlassCardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Nightly 12:00 AM IST · UTR match · skips bank charges
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || isBusy}
            onClick={() => void loadStatus()}
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

      <GlassCardContent className="border-t border-white/50 px-5 py-4">
        {error ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {error}
          </p>
        ) : (
          <p className="text-sm text-slate-800">
            {loading ? (
              'Loading…'
            ) : (
              <>
                <span className="font-medium">
                  Last synced {status?.last_synced_date ?? '—'}
                </span>
                {status?.last_run_at ? (
                  <span className="text-muted-foreground">
                    {' '}
                    · {formatWhen(status.last_run_at)}
                  </span>
                ) : null}
                {status?.last_run_summary ? (
                  <span
                    className={cn(
                      'block mt-1',
                      failed ? 'text-amber-800' : 'text-muted-foreground',
                    )}
                  >
                    {status.last_run_summary}
                  </span>
                ) : null}
              </>
            )}
          </p>
        )}

        {isBusy ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Checking statement…
          </p>
        ) : null}
      </GlassCardContent>
    </GlassCard>
  );
}
