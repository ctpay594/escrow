'use client';

import Link from 'next/link';
import { History, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CompanyBulkTransferPanel } from '@/components/transfer/company-bulk-transfer-panel';
import { CompanyTransferWizard } from '@/components/transfer/company-transfer-wizard';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import {
  GlassCard,
  GlassCardContent,
} from '@/components/ui/glass-card';
import { formatCurrency } from '@/lib/format';
import { glassInset } from '@/lib/glass-styles';
import { cn } from '@/lib/utils';

export function CompanyTransferPanel() {
  const [availableBalance, setAvailableBalance] = useState<number | null>(null);
  const [holdAmount, setHoldAmount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBalance = useCallback(async () => {
    setError(null);

    try {
      const response = await fetch('/api/bank-balance', { cache: 'no-store' });
      const data = await response.json();

      if (response.status === 401) {
        window.location.href = '/api/auth/logout?redirect=/login';
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to load company bank balance');
      }

      const next =
        typeof data.available_balance === 'number'
          ? data.available_balance
          : typeof data.bank_balance === 'number'
            ? data.bank_balance
            : null;

      if (next == null) {
        throw new Error('Company bank balance was not a number');
      }

      setAvailableBalance(next);
      setHoldAmount(
        typeof data.hold_amount === 'number' ? data.hold_amount : null,
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load company bank balance',
      );
      setAvailableBalance(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Transfer"
        description="Move money from the company HDFC current account. Merchant ledgers are not touched."
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => {
                setLoading(true);
                void loadBalance().then(() => toast.success('Balance refreshed'));
              }}
            >
              <RefreshCw
                className={cn('mr-2 h-4 w-4', loading && 'animate-spin')}
              />
              Refresh balance
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/history?merchant=company">
                <History className="mr-2 h-4 w-4" />
                Company history
              </Link>
            </Button>
          </div>
        }
      />

      <GlassCard>
        <GlassCardContent className="grid gap-3 p-5 sm:grid-cols-2">
          <div className={cn(glassInset(), 'px-4 py-3')}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Company available
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {loading || availableBalance == null
                ? '—'
                : formatCurrency(availableBalance)}
            </p>
            {holdAmount != null ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Hold {formatCurrency(holdAmount)}
              </p>
            ) : null}
          </div>
          <div className={cn(glassInset(), 'px-4 py-3 text-sm text-muted-foreground')}>
            <p className="font-medium text-foreground">How this works</p>
            <p className="mt-1.5 leading-relaxed">
              Single or bulk IMPS / NEFT / RTGS from the current account. Rows
              show in History as <span className="text-foreground">Company account</span>.
            </p>
          </div>
        </GlassCardContent>
      </GlassCard>

      {error ? (
        <GlassCard className="border-amber-200/80 bg-amber-50/55">
          <GlassCardContent className="p-4 text-sm text-amber-950">
            {error}
            <Button
              size="sm"
              variant="outline"
              className="ml-3"
              onClick={() => {
                setLoading(true);
                void loadBalance();
              }}
            >
              Retry
            </Button>
          </GlassCardContent>
        </GlassCard>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="mx-auto w-full max-w-lg lg:mx-0">
          <CompanyTransferWizard
            availableBalance={availableBalance ?? 0}
            disabled={loading || availableBalance == null}
            onSubmitted={() => void loadBalance()}
          />
        </div>
        <CompanyBulkTransferPanel
          availableBalance={availableBalance ?? 0}
          disabled={loading || availableBalance == null}
          onSubmitted={() => void loadBalance()}
        />
      </div>
    </div>
  );
}
