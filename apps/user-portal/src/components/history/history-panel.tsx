'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Download,
  FileText,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
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
import { exportTransfersCsv, buildTransferReceiptText } from '@/lib/export-transfers';
import { formatCurrency, formatDate, formatTableDate } from '@/lib/format';
import { glassInset, glassSurface, glassTableHead, glassTableRow } from '@/lib/glass-styles';
import { transferUtr } from '@/lib/transfer-display';
import type { DepositItem, TransferItem } from '@/lib/types';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 8;
const LAST_48_HOURS_MS = 48 * 60 * 60 * 1000;

interface HistoryPanelProps {
  accountLabel: string;
}

function isWithinLast48Hours(value: string) {
  return Date.now() - new Date(value).getTime() <= LAST_48_HOURS_MS;
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
  const [isLoading, setIsLoading] = useState(true);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<TransferItem | null>(null);
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

      const payouts = (Array.isArray(transfersData) ? transfersData : []).map(
        (row: TransferItem) => ({ ...row, kind: row.kind ?? 'payout' }),
      );
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

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return transfers.filter((transfer) => {
      if (!isWithinLast48Hours(transfer.created_at)) {
        return false;
      }

      if (statusFilter === 'processing' && !isProcessingStatus(transfer.status)) {
        return false;
      }

      if (statusFilter === 'CREDITED' && !isDepositRow(transfer)) {
        return false;
      }

      if (statusFilter === 'SUCCESS' && isDepositRow(transfer)) {
        return false;
      }

      if (
        statusFilter !== 'all' &&
        statusFilter !== 'processing' &&
        statusFilter !== 'CREDITED' &&
        transfer.status !== statusFilter
      ) {
        return false;
      }

      if (!query) return true;

      const utr = transferUtr(transfer) ?? '';
      return (
        transfer.beneficiary_account_name.toLowerCase().includes(query) ||
        transfer.payout_ref.toLowerCase().includes(query) ||
        utr.toLowerCase().includes(query) ||
        (transfer.beneficiary_account_no ?? '').toLowerCase().includes(query) ||
        (transfer.beneficiary_ifsc ?? '').toLowerCase().includes(query) ||
        (transfer.virtual_account ?? '').toLowerCase().includes(query)
      );
    });
  }, [transfers, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

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
        description="Last 48 hours · deposits and transfers"
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
                  exportTransfersCsv(filtered, accountLabel);
                  toast.success('CSV exported');
                }}
              >
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  exportTransfersCsv(filtered, accountLabel);
                  toast.success('Excel-compatible CSV exported');
                }}
              >
                Export Excel (.csv)
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  toast.message('PDF export', {
                    description: 'PDF statements will be available in a future release.',
                  })
                }
              >
                Export PDF (soon)
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
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[148px]" aria-label="Filter by status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="PENDING_APPROVAL">Pending approval</SelectItem>
                  <SelectItem value="CREDITED">Deposits</SelectItem>
                  <SelectItem value="SUCCESS">Completed</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
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
              Bank UTR may take a minute after approval.
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
                  ? 'Deposits and transfers from the last 48 hours will appear here.'
                  : 'Try adjusting your search or filters.'
              }
            />
            </div>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                <AnimatePresence>
                  {paginated.map((transfer) => (
                    <motion.button
                      key={transfer.id}
                      type="button"
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(glassSurface(), 'w-full p-4 text-left transition-colors hover:bg-white/55')}
                      onClick={() => setSelected(transfer)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <TransferStatusBadge status={transfer.status} />
                        <p className={cn(
                          'text-lg font-semibold tabular-nums',
                          isDepositRow(transfer) && 'text-emerald-700',
                        )}>
                          {isDepositRow(transfer) ? '+' : ''}
                          {formatCurrency(transfer.amount)}
                        </p>
                      </div>
                      <p className="mt-2 font-medium">
                        {isDepositRow(transfer)
                          ? `Deposit · ${transfer.beneficiary_account_name}`
                          : transfer.beneficiary_account_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(transfer.created_at)}
                      </p>
                      <div className={cn(glassInset(), 'mt-3 space-y-1 px-3 py-2 text-xs')}>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">Ref</span>
                          <span className="break-all text-right font-mono">
                            {transfer.payout_ref}
                          </span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span className="text-muted-foreground">UTR</span>
                          <span className="font-mono">{transferUtrLabel(transfer)}</span>
                        </div>
                      </div>
                    </motion.button>
                  ))}
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
                    {paginated.map((transfer) => (
                      <tr
                        key={transfer.id}
                        className={cn(
                          'cursor-pointer',
                          glassTableRow(
                            isProcessingStatus(transfer.status)
                              ? 'attention'
                              : 'default',
                          ),
                        )}
                        onClick={() => setSelected(transfer)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            setSelected(transfer);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={`View transfer ${transfer.payout_ref}`}
                      >
                        <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                          {formatTableDate(transfer.created_at)}
                        </td>
                        <td className="max-w-[10rem] px-4 py-3">
                          <p className="truncate font-medium">
                            {isDepositRow(transfer)
                              ? `Deposit · ${transfer.beneficiary_account_name}`
                              : transfer.beneficiary_account_name}
                          </p>
                        </td>
                        <td className="px-4 py-3 align-top font-mono text-xs leading-relaxed">
                          <span className="break-all">{transfer.payout_ref}</span>
                        </td>
                        <td className="px-4 py-3 align-top font-mono text-xs text-muted-foreground leading-relaxed">
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
                        </td>
                        <td className={cn(
                          'px-4 py-3 text-right font-medium tabular-nums',
                          isDepositRow(transfer) && 'text-emerald-700',
                        )}>
                          {isDepositRow(transfer) ? '+' : ''}
                          {formatCurrency(transfer.amount)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <TransferStatusBadge status={transfer.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between border-t border-white/50 px-5 py-4">
                <p className="text-sm text-muted-foreground">
                  Last 48 hrs · {filtered.length} transaction{filtered.length === 1 ? '' : 's'}
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
    </div>
  );
}
