'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileText,
  Layers,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  EmptyStateIllustrated,
  ErrorCard,
  PageHeader,
} from '@/components/shared/page-header';
import { TransferStatusBadge } from '@/components/shared/transfer-status-badge';
import { Button } from '@/components/ui/button';
import {
  GlassCard,
  GlassCardContent,
} from '@/components/ui/glass-card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { exportAdminHistoryCsv } from '@/lib/export-history';
import { formatCurrency, formatDate, formatTableDate } from '@/lib/format';
import {
  glassInset,
  glassSurface,
  glassTableHead,
  glassTableRow,
} from '@/lib/glass-styles';
import {
  aggregateBatchStatus,
  batchDisplayTitle,
  buildAdminHistoryEntries,
  entryMatchesMerchant,
  entryMatchesPeriod,
  entryMatchesSearch,
  entryMatchesStatus,
  entryMatchesType,
  entryMerchantId,
  entryMerchantLabel,
  type AdminHistoryEntry,
  type AdminHistoryTransfer,
} from '@/lib/history-display';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

type HistoryPeriod = '48h' | '7d' | 'all';
type HistoryType = 'all' | 'payout' | 'deposit' | 'batch';

interface OnboardedMerchant {
  id: string;
  username: string;
  merchant_name: string;
}

interface AdminDeposit {
  id: string;
  user_id: string | null;
  merchant_id: string | null;
  amount: number;
  utr: string | null;
  virtual_account: string;
  remitter_name: string | null;
  remitter_account: string | null;
  created_at: string;
}

const PERIOD_LABEL: Record<HistoryPeriod, string> = {
  '48h': 'Last 48 hours',
  '7d': 'Last 7 days',
  all: 'All time',
};

function redirectToLoginIfUnauthorized(response: Response): boolean {
  if (response.status === 401) {
    window.location.href = '/api/auth/logout?redirect=/login';
    return true;
  }

  return false;
}

function depositToHistoryRow(
  deposit: AdminDeposit,
  merchants: OnboardedMerchant[],
): AdminHistoryTransfer {
  const merchant =
    merchants.find((item) => item.id === deposit.user_id) ??
    merchants.find((item) => item.id === deposit.merchant_id);

  return {
    id: deposit.id,
    kind: 'deposit',
    batch_id: null,
    user_id: deposit.user_id ?? merchant?.id,
    merchant_id: deposit.merchant_id ?? merchant?.id,
    merchant_name: merchant?.merchant_name,
    username: merchant?.username,
    payout_ref: deposit.utr || deposit.virtual_account,
    amount: Number(deposit.amount),
    payout_mode: 'COLLECT',
    beneficiary_account_name: deposit.remitter_name || 'Incoming deposit',
    beneficiary_account_no: deposit.remitter_account,
    beneficiary_ifsc: null,
    status: 'CREDITED',
    utr: deposit.utr,
    bank_ref: deposit.virtual_account,
    created_at: deposit.created_at,
    remitter_name: deposit.remitter_name,
    remitter_account: deposit.remitter_account,
    virtual_account: deposit.virtual_account,
  };
}

function transferUtr(transfer: AdminHistoryTransfer) {
  if (transfer.status === 'FAILED' || transfer.status === 'REJECTED') {
    return null;
  }

  return transfer.utr ?? null;
}

function entryStatus(entry: AdminHistoryEntry) {
  if (entry.kind === 'batch') {
    return aggregateBatchStatus(entry.transfers);
  }

  return entry.item.status;
}

function entryKey(entry: AdminHistoryEntry) {
  if (entry.kind === 'batch') {
    return `batch-${entry.batchId}`;
  }

  return entry.item.id;
}

export function AdminHistoryPanel() {
  const searchParams = useSearchParams();
  const [transfers, setTransfers] = useState<AdminHistoryTransfer[]>([]);
  const [merchants, setMerchants] = useState<OnboardedMerchant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [merchantId, setMerchantId] = useState(
    () => searchParams.get('merchant') ?? 'all',
  );
  const [period, setPeriod] = useState<HistoryPeriod>('7d');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState<HistoryType>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminHistoryTransfer | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<Extract<
    AdminHistoryEntry,
    { kind: 'batch' }
  > | null>(null);

  const loadData = useCallback(async () => {
    setError(null);

    try {
      const [usersResponse, transfersResponse, depositsResponse] =
        await Promise.all([
          fetch('/api/users', { cache: 'no-store' }),
          fetch('/api/transfers', { cache: 'no-store' }),
          fetch('/api/deposits', { cache: 'no-store' }),
        ]);

      const usersData = await usersResponse.json();
      const transfersData = await transfersResponse.json();
      const depositsData = await depositsResponse.json();

      if (
        redirectToLoginIfUnauthorized(usersResponse) ||
        redirectToLoginIfUnauthorized(transfersResponse) ||
        redirectToLoginIfUnauthorized(depositsResponse)
      ) {
        return;
      }

      if (!usersResponse.ok) {
        throw new Error(usersData.message ?? 'Failed to load merchants');
      }

      if (!transfersResponse.ok) {
        throw new Error(transfersData.message ?? 'Failed to load history');
      }

      const merchantList: OnboardedMerchant[] = (
        Array.isArray(usersData) ? usersData : []
      ).map((merchant: OnboardedMerchant) => ({
        id: merchant.id,
        username: merchant.username,
        merchant_name: merchant.merchant_name,
      }));
      setMerchants(merchantList);

      const payouts: AdminHistoryTransfer[] = (
        Array.isArray(transfersData) ? transfersData : []
      ).map((row: AdminHistoryTransfer) => ({
        ...row,
        kind: row.kind ?? 'payout',
        source: row.source === 'company' ? 'company' : 'merchant',
        user_id: row.user_id,
        merchant_name: row.merchant_name,
        username: row.username,
      }));

      const deposits = (
        depositsResponse.ok && Array.isArray(depositsData)
          ? (depositsData as AdminDeposit[])
          : []
      ).map((deposit) => depositToHistoryRow(deposit, merchantList));

      setTransfers(
        [...payouts, ...deposits].sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Failed to load history',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSyncStatus() {
    setIsSyncing(true);
    setError(null);

    try {
      const response = await fetch('/api/transfers/reconcile-status', {
        method: 'POST',
      });
      const data = await response.json();

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to sync status');
      }

      await loadData();
      toast.success(
        data.updated > 0
          ? `${data.updated} transfer${data.updated === 1 ? '' : 's'} updated`
          : 'All transfers are up to date',
      );
    } catch (syncError) {
      toast.error(
        syncError instanceof Error ? syncError.message : 'Failed to sync status',
      );
    } finally {
      setIsSyncing(false);
    }
  }

  const historyEntries = useMemo(
    () => buildAdminHistoryEntries(transfers),
    [transfers],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return historyEntries.filter((entry) => {
      if (!entryMatchesPeriod(entry, period)) {
        return false;
      }

      if (!entryMatchesMerchant(entry, merchantId)) {
        return false;
      }

      if (!entryMatchesType(entry, typeFilter)) {
        return false;
      }

      if (!entryMatchesStatus(entry, statusFilter)) {
        return false;
      }

      return entryMatchesSearch(entry, query);
    });
  }, [historyEntries, search, merchantId, period, statusFilter, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [search, merchantId, period, statusFilter, typeFilter]);

  function openEntry(entry: AdminHistoryEntry) {
    if (entry.kind === 'batch') {
      setSelectedBatch(entry);
      return;
    }

    setSelected(entry.item);
  }

  const selectedMerchantLabel =
    merchantId === 'all'
      ? 'All onboarded users'
      : merchantId === 'company'
        ? 'Company account'
        : merchants.find((merchant) => merchant.id === merchantId)?.merchant_name ??
          'Selected merchant';

  const typeLabel: Record<HistoryType, string> = {
    all: 'All types',
    payout: 'Single payouts',
    batch: 'Bulk batches',
    deposit: 'Deposits',
  };

  const statusLabel =
    statusFilter === 'all'
      ? 'All statuses'
      : statusFilter === 'PENDING_APPROVAL'
        ? 'Pending approval'
        : statusFilter === 'CREDITED'
          ? 'Deposits'
          : statusFilter === 'SUCCESS'
            ? 'Completed'
            : statusFilter === 'REJECTED'
              ? 'Rejected'
              : statusFilter;

  function downloadStatement() {
    if (filtered.length === 0) {
      toast.message('Nothing to download for the current filters');
      return;
    }

    exportAdminHistoryCsv(filtered, {
      merchantLabel: selectedMerchantLabel,
      periodLabel: PERIOD_LABEL[period],
      typeLabel: typeLabel[typeFilter],
      statusLabel,
    });
    toast.success('Statement downloaded');
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="History"
        description={`${PERIOD_LABEL[period]} · all onboarded merchants`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isLoading || filtered.length === 0}
              onClick={downloadStatement}
            >
              <Download className="mr-2 h-4 w-4" />
              Download statement
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isLoading || isSyncing}
              onClick={() => void handleSyncStatus()}
            >
              <ClipboardCheck className="mr-2 h-4 w-4" />
              {isSyncing ? 'Syncing…' : 'Sync status'}
            </Button>
          </div>
        }
      />

      <GlassCard className="overflow-hidden">
        <div className="space-y-3 border-b border-white/50 px-5 py-4">
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search merchant, beneficiary, UTR…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
                aria-label="Search history"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Select value={merchantId} onValueChange={setMerchantId}>
                <SelectTrigger className="w-full sm:w-[220px]" aria-label="Filter by merchant">
                  <SelectValue placeholder="All merchants" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all">All onboarded users</SelectItem>
                  <SelectItem value="company">Company account</SelectItem>
                  {merchants.map((merchant) => (
                    <SelectItem key={merchant.id} value={merchant.id}>
                      {merchant.merchant_name} · {merchant.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={period}
                onValueChange={(value) => setPeriod(value as HistoryPeriod)}
              >
                <SelectTrigger className="w-full sm:w-[148px]" aria-label="Filter by period">
                  <SelectValue placeholder="Period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="48h">Last 48 hours</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={typeFilter}
                onValueChange={(value) => setTypeFilter(value as HistoryType)}
              >
                <SelectTrigger className="w-full sm:w-[148px]" aria-label="Filter by type">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="payout">Single payouts</SelectItem>
                  <SelectItem value="batch">Bulk batches</SelectItem>
                  <SelectItem value="deposit">Deposits</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[168px]" aria-label="Filter by status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="PENDING_APPROVAL">Pending approval</SelectItem>
                  <SelectItem value="PROCESSING">Processing</SelectItem>
                  <SelectItem value="CREDITED">Deposits</SelectItem>
                  <SelectItem value="SUCCESS">Completed</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <GlassCardContent className="p-0">
          {error ? (
            <div className="p-5">
              <ErrorCard
                message={error}
                onRetry={() => {
                  setIsLoading(true);
                  void loadData();
                }}
              />
            </div>
          ) : isLoading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyStateIllustrated
                icon={FileText}
                title="No transactions found"
                description="Try a different merchant, period, type, or status filter."
              />
            </div>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {paginated.map((entry) => {
                  const status = entryStatus(entry);
                  const isBatch = entry.kind === 'batch';
                  const isDeposit = entry.kind === 'deposit';
                  const createdAt =
                    entry.kind === 'batch' ? entry.created_at : entry.item.created_at;
                  const amount =
                    entry.kind === 'batch' ? entry.totalAmount : entry.item.amount;

                  return (
                    <button
                      key={entryKey(entry)}
                      type="button"
                      className={cn(
                        glassSurface(),
                        'w-full p-4 text-left transition-colors hover:bg-white/55',
                      )}
                      onClick={() => openEntry(entry)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <TransferStatusBadge status={status} />
                        <p
                          className={cn(
                            'font-semibold tabular-nums',
                            isDeposit && 'text-emerald-700',
                          )}
                        >
                          {isDeposit ? '+' : ''}
                          {formatCurrency(amount)}
                        </p>
                      </div>
                      <p className="mt-2 text-xs font-medium text-muted-foreground">
                        {entryMerchantLabel(entry)}
                      </p>
                      <p className="mt-1 flex items-center gap-2 font-medium">
                        {isBatch ? (
                          <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : null}
                        {isBatch
                          ? batchDisplayTitle(entry)
                          : isDeposit
                            ? `Deposit · ${entry.item.beneficiary_account_name}`
                            : entry.item.beneficiary_account_name}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(createdAt)}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-left text-sm">
                  <thead className={glassTableHead()}>
                    <tr>
                      <th className="px-5 py-3">Date</th>
                      <th className="px-4 py-3">Merchant</th>
                      <th className="px-4 py-3">Party</th>
                      <th className="px-4 py-3">Ref</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-5 py-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/50">
                    {paginated.map((entry) => {
                      const status = entryStatus(entry);
                      const isBatch = entry.kind === 'batch';
                      const isDeposit = entry.kind === 'deposit';
                      const createdAt =
                        entry.kind === 'batch'
                          ? entry.created_at
                          : entry.item.created_at;
                      const amount =
                        entry.kind === 'batch'
                          ? entry.totalAmount
                          : entry.item.amount;
                      const merchantIdForLink = entryMerchantId(entry);

                      return (
                        <tr
                          key={entryKey(entry)}
                          className={cn(
                            'cursor-pointer',
                            glassTableRow(
                              status === 'PENDING_APPROVAL' ? 'attention' : 'default',
                            ),
                          )}
                          onClick={() => openEntry(entry)}
                        >
                          <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                            {formatTableDate(createdAt)}
                          </td>
                          <td className="px-4 py-3">
                            {merchantIdForLink ? (
                              <Link
                                href={`/merchants/${merchantIdForLink}`}
                                className="font-medium hover:underline"
                                onClick={(event) => event.stopPropagation()}
                              >
                                {entryMerchantLabel(entry)}
                              </Link>
                            ) : (
                              <span className="font-medium">
                                {entryMerchantLabel(entry)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-2">
                              {isBatch ? (
                                <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                              ) : null}
                              {isBatch
                                ? batchDisplayTitle(entry)
                                : isDeposit
                                  ? `Deposit · ${entry.item.beneficiary_account_name}`
                                  : entry.item.beneficiary_account_name}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">
                            {isBatch
                              ? `${entry.batchId.slice(0, 8)} · ${entry.transfers.length}`
                              : entry.item.payout_ref}
                          </td>
                          <td
                            className={cn(
                              'px-4 py-3 text-right font-medium tabular-nums',
                              isDeposit && 'text-emerald-700',
                            )}
                          >
                            {isDeposit ? '+' : ''}
                            {formatCurrency(amount)}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <TransferStatusBadge status={status} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between border-t border-white/50 px-5 py-4">
                <p className="text-sm text-muted-foreground">
                  {PERIOD_LABEL[period]} · {filtered.length} item
                  {filtered.length === 1 ? '' : 's'}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => current - 1)}
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm tabular-nums">
                    {page} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={page >= totalPages}
                    onClick={() => setPage((current) => current + 1)}
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </GlassCardContent>
      </GlassCard>

      <Dialog open={Boolean(selected)} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selected?.kind === 'deposit' ? 'Deposit details' : 'Transfer details'}
            </DialogTitle>
          </DialogHeader>
          {selected ? (
            <dl className={cn(glassInset(), 'rounded-xl px-4 py-1 text-sm')}>
              <div className="flex justify-between gap-4 border-b border-white/50 py-2.5">
                <dt className="text-muted-foreground">Merchant</dt>
                <dd className="font-medium">
                  {selected.merchant_name || selected.username || '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-white/50 py-2.5">
                <dt className="text-muted-foreground">Party</dt>
                <dd className="font-medium">{selected.beneficiary_account_name}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-white/50 py-2.5">
                <dt className="text-muted-foreground">Amount</dt>
                <dd className="font-semibold tabular-nums">
                  {selected.kind === 'deposit' ? '+' : ''}
                  {formatCurrency(selected.amount)}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-white/50 py-2.5">
                <dt className="text-muted-foreground">Mode</dt>
                <dd>{selected.payout_mode ?? 'IMPS'}</dd>
              </div>
              <div className="flex justify-between gap-4 border-b border-white/50 py-2.5">
                <dt className="text-muted-foreground">Ref</dt>
                <dd className="break-all font-mono text-xs">{selected.payout_ref}</dd>
              </div>
              <div className="flex justify-between gap-4 py-2.5">
                <dt className="text-muted-foreground">UTR</dt>
                <dd className="font-mono text-xs">{transferUtr(selected) ?? '—'}</dd>
              </div>
            </dl>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedBatch)}
        onOpenChange={() => setSelectedBatch(null)}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {selectedBatch ? batchDisplayTitle(selectedBatch) : 'Batch'}
            </DialogTitle>
          </DialogHeader>
          {selectedBatch ? (
            <div className="max-h-[50vh] overflow-auto">
              <p className="mb-3 text-sm text-muted-foreground">
                {entryMerchantLabel(selectedBatch)} · {selectedBatch.transfers.length}{' '}
                payouts · {formatCurrency(selectedBatch.totalAmount)}
              </p>
              <table className="min-w-full text-left text-sm">
                <thead className={glassTableHead()}>
                  <tr>
                    <th className="px-3 py-2">Beneficiary</th>
                    <th className="px-3 py-2">Mode</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">UTR</th>
                    <th className="px-3 py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/50">
                  {selectedBatch.transfers.map((transfer) => (
                    <tr key={transfer.id}>
                      <td className="px-3 py-2 font-medium">
                        {transfer.beneficiary_account_name}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {transfer.payout_mode ?? 'IMPS'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(transfer.amount)}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {transferUtr(transfer) ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <TransferStatusBadge status={transfer.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
