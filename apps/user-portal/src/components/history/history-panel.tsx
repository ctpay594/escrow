'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  FileText,
  Layers,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { toast } from 'sonner';
import { BatchDetailDialog } from '@/components/history/batch-detail-dialog';
import {
  EmptyStateIllustrated,
  ErrorCard,
  PageHeader,
} from '@/components/shared/page-header';
import { TransferDetailDialog } from '@/components/shared/transfer-detail-dialog';
import { TransferStatusBadge } from '@/components/shared/transfer-status-badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import {
  GlassCard,
  GlassCardContent,
} from '@/components/ui/glass-card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { depositToHistoryRow, isDepositRow } from '@/lib/deposit-display';
import { exportBatchStatementXlsx } from '@/lib/export-batch';
import {
  exportHistoryEntriesCsv,
  buildTransferReceiptText,
} from '@/lib/export-transfers';
import { formatCurrency, formatDate, formatTableDate } from '@/lib/format';
import {
  aggregateBatchStatus,
  batchDisplayTitle,
  buildHistoryEntries,
  entryMatchesPeriod,
  entryMatchesSearch,
  entryMatchesStatus,
  parseUserTransfersResponse,
  type TransferBatchMeta,
  type HistoryEntry,
} from '@/lib/history-display';
import { glassInset, glassSurface, glassTableHead, glassTableRow } from '@/lib/glass-styles';
import { transferUtr } from '@/lib/transfer-display';
import type { DepositItem, TransferItem } from '@/lib/types';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

type HistoryPeriod = '48h' | '7d' | 'all';

const PERIOD_LABEL: Record<HistoryPeriod, string> = {
  '48h': 'Last 48 hours',
  '7d': 'Last 7 days',
  all: 'All time',
};

interface HistoryPanelProps {
  accountLabel: string;
}

function entryStatus(entry: HistoryEntry) {
  if (entry.kind === 'batch') {
    return aggregateBatchStatus(entry.transfers);
  }

  return entry.item.status;
}

function isEntryProcessing(entry: HistoryEntry) {
  return isProcessingStatus(entryStatus(entry));
}

function isProcessingStatus(status: string) {
  return status === 'PENDING_APPROVAL' || status === 'PROCESSING';
}

function transferUtrLabel(transfer: TransferItem) {
  const utr = transferUtr(transfer);
  if (utr) {
    return utr;
  }

  if (isProcessingStatus(transfer.status)) {
    return '—';
  }

  return '—';
}

function HistoryTableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

export function HistoryPanel({ accountLabel }: HistoryPanelProps) {
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [batchMeta, setBatchMeta] = useState<Map<string, TransferBatchMeta>>(
    () => new Map(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [period, setPeriod] = useState<HistoryPeriod>('7d');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<TransferItem | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<Extract<
    HistoryEntry,
    { kind: 'batch' }
  > | null>(null);
  const autoCheckedRef = useRef(false);

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
        throw new Error(transfersData.message ?? 'Failed to load history');
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
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load history',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTransfers();
  }, [loadTransfers]);

  const checkStatus = useCallback(async (options?: { silent?: boolean }) => {
    setIsCheckingStatus(true);
    setError(null);

    try {
      const response = await fetch('/api/transfers/reconcile-status', {
        method: 'POST',
      });
      const data = await response.json();

      if (response.status === 401) {
        window.location.href = '/api/auth/logout?redirect=/login';
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to check status');
      }

      await loadTransfers();

      if (options?.silent) {
        return;
      }

      if (data.updated > 0) {
        toast.success(
          `${data.updated} transfer${data.updated === 1 ? '' : 's'} updated`,
        );
      } else if (data.stillProcessing > 0) {
        toast.message('Still processing — bank confirmation pending');
      } else {
        toast.message('All transfers are up to date');
      }
    } catch (checkError) {
      const message =
        checkError instanceof Error
          ? checkError.message
          : 'Failed to check status';
      setError(message);
      if (!options?.silent) {
        toast.error(message);
      }
    } finally {
      setIsCheckingStatus(false);
    }
  }, [loadTransfers]);

  const hasInFlightTransfers = useMemo(
    () => transfers.some((transfer) => isProcessingStatus(transfer.status)),
    [transfers],
  );

  const hasBankProcessing = useMemo(
    () => transfers.some((transfer) => transfer.status === 'PROCESSING'),
    [transfers],
  );

  useEffect(() => {
    if (
      isLoading ||
      autoCheckedRef.current ||
      !hasBankProcessing
    ) {
      return;
    }

    autoCheckedRef.current = true;
    void checkStatus({ silent: true });
  }, [checkStatus, hasBankProcessing, isLoading]);

  const historyEntries = useMemo(
    () => buildHistoryEntries(transfers, batchMeta),
    [transfers, batchMeta],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return historyEntries.filter((entry) => {
      if (!entryMatchesPeriod(entry, period)) {
        return false;
      }

      if (!entryMatchesStatus(entry, statusFilter)) {
        return false;
      }

      return entryMatchesSearch(entry, query);
    });
  }, [historyEntries, search, statusFilter, period]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, period]);

  function downloadBatchSheet(
    entry: Extract<HistoryEntry, { kind: 'batch' }>,
    event?: MouseEvent,
  ) {
    event?.stopPropagation();
    exportBatchStatementXlsx(entry.transfers, {
      label: entry.label,
      batchId: entry.batchId,
    });
    toast.success('Batch statement downloaded');
  }

  function openEntry(entry: HistoryEntry) {
    if (entry.kind === 'batch') {
      setSelectedBatch(entry);
      return;
    }

    setSelected(entry.item);
  }

  function entryKey(entry: HistoryEntry) {
    if (entry.kind === 'batch') {
      return `batch-${entry.batchId}`;
    }

    return entry.item.id;
  }

  function downloadReceipt(transfer: TransferItem) {
    if (isDepositRow(transfer)) {
      toast.message('Deposits do not have a payout receipt');
      return;
    }
    const blob = new Blob([buildTransferReceiptText(transfer)], {
      type: 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ctpay-receipt-${transfer.payout_ref}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Receipt downloaded');
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="History"
        description={`${PERIOD_LABEL[period]} · deposits and transfers`}
        action={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={filtered.length === 0}
              >
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  exportHistoryEntriesCsv(
                    filtered,
                    accountLabel,
                    PERIOD_LABEL[period],
                  );
                  toast.success('CSV exported');
                }}
              >
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  exportHistoryEntriesCsv(
                    filtered,
                    accountLabel,
                    PERIOD_LABEL[period],
                  );
                  toast.success('Excel-compatible CSV exported');
                }}
              >
                Export Excel (.csv)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <GlassCard className="overflow-hidden">
        <div className="space-y-3 border-b border-white/50 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search remitter, beneficiary, UTR…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label="Search transfers"
              />
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
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
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[148px]" aria-label="Filter by status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="CREDITED">Deposits</SelectItem>
                  <SelectItem value="SUCCESS">Completed</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="REJECTED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="w-full sm:w-auto"
                aria-label="Check status"
                disabled={isLoading || isCheckingStatus}
                onClick={() => void checkStatus()}
              >
                <ClipboardCheck className="mr-2 h-4 w-4" />
                {isCheckingStatus ? 'Checking…' : 'Check status'}
              </Button>
            </div>
          </div>
          {hasInFlightTransfers ? (
            <p className="text-xs text-muted-foreground">
              Bank UTR may take a minute to appear.
            </p>
          ) : null}
        </div>

        <GlassCardContent className="p-0">
          {error ? (
            <div className="p-5">
              <ErrorCard
                message={error}
                onRetry={() => {
                  setIsLoading(true);
                  void loadTransfers();
                }}
              />
            </div>
          ) : isLoading ? (
            <div className="p-5">
              <HistoryTableSkeleton />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyStateIllustrated
              icon={FileText}
              title="No transactions found"
              description={
                transfers.length === 0
                  ? 'Deposits and transfers will appear here.'
                  : 'Try a different period, search, or status filter.'
              }
            />
            </div>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                <AnimatePresence>
                  {paginated.map((entry) => {
                    const status = entryStatus(entry);
                    const isBatch = entry.kind === 'batch';
                    const isDeposit = entry.kind === 'deposit';
                    const transfer = entry.kind === 'batch' ? null : entry.item;
                    const createdAt =
                      entry.kind === 'batch' ? entry.created_at : entry.item.created_at;
                    const amount =
                      entry.kind === 'batch'
                        ? entry.totalAmount
                        : entry.item.amount;

                    return (
                      <motion.div
                        key={entryKey(entry)}
                        layout
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={cn(
                          glassSurface(),
                          'w-full cursor-pointer p-4 text-left transition-colors hover:bg-white/55',
                        )}
                        onClick={() => openEntry(entry)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            openEntry(entry);
                          }
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <TransferStatusBadge status={status} />
                          <p
                            className={cn(
                              'text-lg font-semibold tabular-nums',
                              isDeposit && 'text-emerald-700',
                            )}
                          >
                            {isDeposit ? '+' : ''}
                            {formatCurrency(amount)}
                          </p>
                        </div>
                        <p className="mt-2 flex items-center gap-2 font-medium">
                          {isBatch ? (
                            <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : null}
                          {isBatch
                            ? batchDisplayTitle(entry)
                            : isDeposit
                              ? `Deposit · ${transfer?.beneficiary_account_name}`
                              : transfer?.beneficiary_account_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(createdAt)}
                        </p>
                        <div
                          className={cn(
                            glassInset(),
                            'mt-3 space-y-1 px-3 py-2 text-xs',
                          )}
                        >
                          {isBatch ? (
                            <>
                              <div className="flex justify-between gap-3">
                                <span className="text-muted-foreground">Batch</span>
                                <span className="font-mono">
                                  {entry.batchId.slice(0, 8)}
                                </span>
                              </div>
                              <div className="flex justify-between gap-3">
                                <span className="text-muted-foreground">Payouts</span>
                                <span>{entry.transfers.length}</span>
                              </div>
                            </>
                          ) : transfer ? (
                            <>
                              <div className="flex justify-between gap-3">
                                <span className="text-muted-foreground">Ref</span>
                                <span className="break-all text-right font-mono">
                                  {transfer.payout_ref}
                                </span>
                              </div>
                              <div className="flex justify-between gap-3">
                                <span className="text-muted-foreground">UTR</span>
                                <span className="font-mono">
                                  {transferUtrLabel(transfer)}
                                </span>
                              </div>
                            </>
                          ) : null}
                        </div>
                        {isBatch ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3 w-full"
                            onClick={(event) => downloadBatchSheet(entry, event)}
                          >
                            <FileSpreadsheet className="mr-2 h-4 w-4" />
                            Download batch Excel
                          </Button>
                        ) : null}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-left text-sm">
                  <thead className={glassTableHead()}>
                    <tr>
                      <th className="px-5 py-3 text-left">Date</th>
                      <th className="px-4 py-3 text-left">Party</th>
                      <th className="min-w-[11rem] px-4 py-3 text-left">Payment ref</th>
                      <th className="min-w-[9rem] px-4 py-3 text-left">UTR</th>
                      <th className="px-4 py-3 text-right">Amount</th>
                      <th className="px-5 py-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/50">
                    {paginated.map((entry) => {
                      const status = entryStatus(entry);
                      const isBatch = entry.kind === 'batch';
                      const isDeposit = entry.kind === 'deposit';
                      const transfer = entry.kind === 'batch' ? null : entry.item;
                      const createdAt =
                        entry.kind === 'batch' ? entry.created_at : entry.item.created_at;
                      const amount =
                        entry.kind === 'batch'
                          ? entry.totalAmount
                          : entry.item.amount;

                      return (
                        <tr
                          key={entryKey(entry)}
                          className={cn(
                            'cursor-pointer',
                            glassTableRow(
                              isEntryProcessing(entry) ? 'attention' : 'default',
                            ),
                          )}
                          onClick={() => openEntry(entry)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              openEntry(entry);
                            }
                          }}
                          tabIndex={0}
                          role="button"
                          aria-label={
                            isBatch
                              ? `View batch ${entry.batchId}`
                              : `View transfer ${transfer?.payout_ref}`
                          }
                        >
                          <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                            {formatTableDate(createdAt)}
                          </td>
                          <td className="max-w-[12rem] px-4 py-3">
                            <p className="flex items-center gap-2 truncate font-medium">
                              {isBatch ? (
                                <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
                              ) : null}
                              <span className="truncate">
                                {isBatch
                                  ? batchDisplayTitle(entry)
                                  : isDeposit
                                    ? `Deposit · ${transfer?.beneficiary_account_name}`
                                    : transfer?.beneficiary_account_name}
                              </span>
                            </p>
                          </td>
                          <td className="px-4 py-3 align-top font-mono text-xs leading-relaxed">
                            <span className="break-all">
                              {isBatch
                                ? entry.batchId.slice(0, 8)
                                : transfer?.payout_ref}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-top font-mono text-xs text-muted-foreground leading-relaxed">
                            {isBatch ? (
                              <span>{entry.transfers.length} payouts</span>
                            ) : transfer ? (
                              <span
                                className="break-all"
                                title={
                                  isProcessingStatus(transfer.status) &&
                                  !transferUtr(transfer)
                                    ? 'UTR pending'
                                    : undefined
                                }
                              >
                                {transferUtrLabel(transfer)}
                              </span>
                            ) : null}
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
                            <div className="flex items-center justify-end gap-2">
                              {isBatch ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  aria-label="Download batch Excel"
                                  onClick={(event) => downloadBatchSheet(entry, event)}
                                >
                                  <FileSpreadsheet className="h-4 w-4" />
                                </Button>
                              ) : null}
                              <TransferStatusBadge status={status} />
                            </div>
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
                    onClick={() => setPage((p) => p - 1)}
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
                    onClick={() => setPage((p) => p + 1)}
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

      <TransferDetailDialog
        transfer={selected}
        onClose={() => setSelected(null)}
        onDownloadReceipt={downloadReceipt}
      />

      <BatchDetailDialog
        entry={selectedBatch}
        onClose={() => setSelectedBatch(null)}
      />
    </div>
  );
}
