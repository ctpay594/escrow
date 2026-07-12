'use client';

import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Search,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import {
  EmptyStateIllustrated,
  ErrorCard,
  PageHeader,
} from '@/components/shared/page-header';
import {
  SeriousConfirmDialog,
  type SeriousConfirmOptions,
} from '@/components/shared/serious-confirm-dialog';
import {
  TransferActionDialog,
  type TransferActionDetails,
} from '@/components/shared/transfer-action-dialog';
import { TransferStatusBadge } from '@/components/shared/transfer-status-badge';
import { Button } from '@/components/ui/button';
import {
  GlassCard,
  GlassCardContent,
  GlassCardHeader,
  GlassCardTitle,
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
import { formatCurrency, formatDate, formatTableDate } from '@/lib/format';
import { glassInset, glassSurface, glassTableHead, glassTableRow } from '@/lib/glass-styles';
import { cn } from '@/lib/utils';

type TransferStatus =
  | 'PENDING_APPROVAL'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'REJECTED';

interface AdminTransfer {
  id: string;
  batch_id: string | null;
  user_id: string;
  merchant_id: string;
  merchant_name: string;
  username: string;
  payout_ref: string;
  amount: number;
  payout_mode: string;
  transaction_note: string | null;
  beneficiary_account_name: string;
  beneficiary_account_no: string | null;
  beneficiary_ifsc: string | null;
  beneficiary_vpa: string | null;
  payee_user_ref: string | null;
  payee_user_name: string | null;
  status: TransferStatus;
  utr: string | null;
  bank_ref: string | null;
  escrow_response: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

function displayValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  return String(value);
}

function TransferDetailRow({
  label,
  value,
  mono = false,
  children,
}: {
  label: string;
  value?: string | number | null;
  mono?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/50 py-2.5 last:border-0">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd
        className={`min-w-0 text-right ${mono ? 'font-mono text-xs break-all' : 'font-medium'}`}
      >
        {children ?? displayValue(value)}
      </dd>
    </div>
  );
}

function transferDestination(transfer: AdminTransfer): string {
  if (transfer.payout_mode === 'UPI') {
    return transfer.beneficiary_vpa ?? '—';
  }

  const account = transfer.beneficiary_account_no ?? '—';
  const ifsc = transfer.beneficiary_ifsc ?? '—';
  return `${account} · ${ifsc}`;
}

const PAGE_SIZE = 8;

function transferUtr(transfer: AdminTransfer) {
  return transfer.utr ?? transfer.bank_ref ?? null;
}

function transferUtrLabel(transfer: AdminTransfer) {
  const utr = transferUtr(transfer);
  if (utr) {
    return utr;
  }

  if (
    transfer.status === 'PENDING_APPROVAL' ||
    transfer.status === 'PROCESSING'
  ) {
    return '—';
  }

  return '—';
}

interface MerchantTransfersPanelProps {
  merchantId: string;
  merchantName: string;
  embedded?: boolean;
}

function redirectToLoginIfUnauthorized(response: Response): boolean {
  if (response.status === 401) {
    window.location.href = '/api/auth/logout?redirect=/login';
    return true;
  }

  return false;
}

export function MerchantTransfersPanel({
  merchantId,
  merchantName,
  embedded = false,
}: MerchantTransfersPanelProps) {
  const [transfers, setTransfers] = useState<AdminTransfer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AdminTransfer | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmOptions, setConfirmOptions] =
    useState<SeriousConfirmOptions | null>(null);
  const [confirmAction, setConfirmAction] = useState<(() => Promise<void>) | null>(
    null,
  );
  const [batchActionId, setBatchActionId] = useState<string | null>(null);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionDialogMode, setActionDialogMode] = useState<
    'approve' | 'reject' | null
  >(null);
  const [actionTransfer, setActionTransfer] =
    useState<TransferActionDetails | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);

  function askConfirmation(
    options: SeriousConfirmOptions,
    action: () => Promise<void>,
  ) {
    setConfirmOptions(options);
    setConfirmAction(() => action);
    setConfirmOpen(true);
  }

  async function runConfirmedAction() {
    if (!confirmAction) return;

    setConfirmOpen(false);
    await confirmAction();
    setConfirmAction(null);
    setConfirmOptions(null);
  }

  const loadTransfers = useCallback(async () => {
    setError(null);

    try {
      const response = await fetch(
        `/api/transfers?user_id=${encodeURIComponent(merchantId)}`,
      );
      const data = await response.json();

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to load transfers');
      }

      setTransfers(data);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Failed to load transfers',
      );
    } finally {
      setIsLoading(false);
    }
  }, [merchantId]);

  useEffect(() => {
    setIsLoading(true);
    void loadTransfers();
  }, [loadTransfers]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();

    return transfers.filter((transfer) => {
      if (statusFilter !== 'all' && transfer.status !== statusFilter) {
        return false;
      }

      if (!query) return true;

      const utr = transferUtr(transfer) ?? '';
      return (
        transfer.beneficiary_account_name.toLowerCase().includes(query) ||
        transfer.payout_ref.toLowerCase().includes(query) ||
        utr.toLowerCase().includes(query) ||
        (transfer.beneficiary_account_no ?? '').toLowerCase().includes(query) ||
        (transfer.beneficiary_ifsc ?? '').toLowerCase().includes(query)
      );
    });
  }, [transfers, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pendingCount = transfers.filter(
    (transfer) => transfer.status === 'PENDING_APPROVAL',
  ).length;

  const pendingBatches = useMemo(() => {
    const map = new Map<
      string,
      { batchId: string; count: number; total: number }
    >();

    for (const transfer of transfers) {
      if (transfer.status !== 'PENDING_APPROVAL' || !transfer.batch_id) {
        continue;
      }

      const current = map.get(transfer.batch_id) ?? {
        batchId: transfer.batch_id,
        count: 0,
        total: 0,
      };
      current.count += 1;
      current.total += transfer.amount;
      map.set(transfer.batch_id, current);
    }

    return Array.from(map.values()).filter((batch) => batch.count >= 2);
  }, [transfers]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  async function handleSyncStatus() {
    setIsSyncing(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/transfers/reconcile-status?user_id=${encodeURIComponent(merchantId)}`,
        { method: 'POST' },
      );
      const data = await response.json();

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to sync status');
      }

      await loadTransfers();

      if (data.updated > 0) {
        toast.success(`${data.updated} transfer(s) updated`);
      } else if (data.stillProcessing > 0) {
        toast.message('Still processing at bank');
      } else {
        toast.message('All transfers up to date');
      }
    } catch (syncError) {
      toast.error(
        syncError instanceof Error ? syncError.message : 'Failed to sync status',
      );
    } finally {
      setIsSyncing(false);
    }
  }

  function handleApproveBatch(batchId: string, count: number, total: number) {
    askConfirmation(
      {
        title: `Approve ${count} bulk transfers?`,
        description: `Submit ${formatCurrency(total)} across ${count} payouts to EscrowStack one by one.`,
        confirmLabel: 'Yes, approve all',
      },
      async () => {
        setBatchActionId(batchId);

        try {
          const response = await fetch(
            `/api/transfers/batches/${batchId}/approve-all`,
            { method: 'POST' },
          );
          const data = await response.json();

          if (redirectToLoginIfUnauthorized(response)) {
            return;
          }

          if (!response.ok) {
            throw new Error(data.message ?? 'Failed to approve batch');
          }

          toast.success(
            `${data.approved} approved${data.failed?.length ? `, ${data.failed.length} failed` : ''}`,
          );
          await loadTransfers();
        } catch (batchError) {
          toast.error(
            batchError instanceof Error
              ? batchError.message
              : 'Failed to approve batch',
          );
        } finally {
          setBatchActionId(null);
        }
      },
    );
  }

  function openTransferAction(
    mode: 'approve' | 'reject',
    transfer: AdminTransfer,
  ) {
    setActionDialogMode(mode);
    setActionTransfer({
      beneficiaryName: transfer.beneficiary_account_name,
      amount: transfer.amount,
      payoutRef: transfer.payout_ref,
    });
    setPendingActionId(transfer.id);
    setRejectReason('');
    setActionDialogOpen(true);
  }

  function closeTransferAction() {
    setActionDialogOpen(false);
    setActionDialogMode(null);
    setActionTransfer(null);
    setPendingActionId(null);
    setRejectReason('');
  }

  async function confirmTransferAction() {
    if (!pendingActionId || !actionDialogMode) {
      return;
    }

    const id = pendingActionId;
    setActionId(id);

    try {
      const endpoint =
        actionDialogMode === 'approve'
          ? `/api/transfers/${id}/approve`
          : `/api/transfers/${id}/reject`;

      const response = await fetch(endpoint, { method: 'POST' });
      const data = await response.json();

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(
          data.message ??
            `Failed to ${actionDialogMode} transfer`,
        );
      }

      toast.success(
        actionDialogMode === 'approve'
          ? `${actionTransfer?.payoutRef ?? 'Transfer'} submitted — UTR sync runs in background`
          : `${actionTransfer?.payoutRef ?? 'Transfer'} rejected`,
      );
      closeTransferAction();
      await loadTransfers();
    } catch (actionError) {
      toast.error(
        actionError instanceof Error
          ? actionError.message
          : `Failed to ${actionDialogMode} transfer`,
      );
    } finally {
      setActionId(null);
    }
  }

  function handleApprove(transfer: AdminTransfer) {
    openTransferAction('approve', transfer);
  }

  function handleReject(transfer: AdminTransfer) {
    openTransferAction('reject', transfer);
  }

  return (
    <div className={embedded ? 'space-y-0' : 'space-y-4'}>
      {!embedded ? (
        <PageHeader
          title="Transfers"
          description={`All transfers for ${merchantName}. Approve pending requests here.`}
          action={
            pendingCount > 0 ? (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
                {pendingCount} pending approval
              </span>
            ) : undefined
          }
        />
      ) : null}

      <GlassCard className="overflow-hidden">
        <GlassCardHeader className={`space-y-3 py-3 ${embedded ? 'border-b border-white/50' : 'pb-4'}`}>
          {embedded ? (
            <div className="flex items-center justify-between gap-2">
              <GlassCardTitle className="text-sm font-medium">Transfers</GlassCardTitle>
              {pendingCount > 0 ? (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                  {pendingCount} pending
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search beneficiary, ref, UTR, account..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-white/60 pl-9 backdrop-blur-sm"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="PENDING_APPROVAL">Pending approval</SelectItem>
                  <SelectItem value="PROCESSING">Processing</SelectItem>
                  <SelectItem value="SUCCESS">Completed</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="REJECTED">Rejected</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                disabled={isSyncing || isLoading}
                onClick={() => void handleSyncStatus()}
              >
                <ClipboardCheck className="mr-2 h-4 w-4" />
                {isSyncing ? 'Syncing…' : 'Sync status'}
              </Button>
            </div>
          </div>
        </GlassCardHeader>

        {pendingBatches.length > 0 ? (
          <div className="space-y-2 border-b border-white/50 px-6 pb-4">
            {pendingBatches.map((batch) => (
              <div
                key={batch.batchId}
                className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="text-sm">
                  <p className="font-medium">
                    Bulk batch · {batch.count} transfers
                  </p>
                  <p className="text-muted-foreground tabular-nums">
                    Total {formatCurrency(batch.total)} ·{' '}
                    <span className="font-mono text-xs">{batch.batchId.slice(0, 8)}</span>
                  </p>
                </div>
                <Button
                  size="sm"
                  disabled={batchActionId === batch.batchId}
                  onClick={() =>
                    handleApproveBatch(batch.batchId, batch.count, batch.total)
                  }
                >
                  {batchActionId === batch.batchId ? 'Approving…' : 'Approve all'}
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <GlassCardContent className="p-0 sm:p-6">
          {error ? (
            <ErrorCard message={error} onRetry={() => void loadTransfers()} />
          ) : isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyStateIllustrated
              icon={FileText}
              title="No transfers"
              description="This merchant has no transfers matching your filters."
            />
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {paginated.map((transfer) => (
                  <div
                    key={transfer.id}
                    className={cn(glassSurface(), 'p-4')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <TransferStatusBadge status={transfer.status} />
                      <p className="font-semibold tabular-nums">
                        {formatCurrency(transfer.amount)}
                      </p>
                    </div>
                    <p className="mt-2 font-medium">
                      {transfer.beneficiary_account_name}
                    </p>
                    <div className={cn(glassInset(), 'mt-3 space-y-1 px-3 py-2 text-xs')}>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">Ref</span>
                        <span className="font-mono">{transfer.payout_ref}</span>
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-muted-foreground">UTR</span>
                        <span className="font-mono">{transferUtrLabel(transfer)}</span>
                      </div>
                    </div>
                    {transfer.status === 'PENDING_APPROVAL' ? (
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          className="flex-1"
                          disabled={actionId === transfer.id}
                          onClick={() => handleApprove(transfer)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 text-destructive"
                          disabled={actionId === transfer.id}
                          onClick={() => handleReject(transfer)}
                        >
                          Reject
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              <div className="hidden overflow-x-auto md:block">
                <table className="min-w-full text-left text-sm">
                  <thead className={glassTableHead()}>
                    <tr>
                      <th className="px-3 py-2.5 text-left font-medium">Date</th>
                      <th className="px-3 py-2.5 text-left font-medium">Beneficiary</th>
                      <th className="px-3 py-2.5 text-left font-medium">Payment ref</th>
                      <th className="px-3 py-2.5 text-left font-medium">UTR</th>
                      <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                      <th className="px-3 py-2.5 text-right font-medium">Status</th>
                      <th className="px-3 py-2.5 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/50">
                    {paginated.map((transfer) => (
                      <tr
                        key={transfer.id}
                        className={glassTableRow(
                          transfer.status === 'PENDING_APPROVAL'
                            ? 'attention'
                            : 'default',
                        )}
                      >
                        <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                          {formatTableDate(transfer.created_at)}
                        </td>
                        <td className="px-3 py-3 font-medium">
                          {transfer.beneficiary_account_name}
                        </td>
                        <td className="px-3 py-3 font-mono text-xs">
                          {transfer.payout_ref}
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                          <span
                            title={
                              !transferUtr(transfer) &&
                              (transfer.status === 'PENDING_APPROVAL' ||
                                transfer.status === 'PROCESSING')
                                ? 'UTR pending'
                                : undefined
                            }
                          >
                            {transferUtrLabel(transfer)}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right font-medium tabular-nums">
                          {formatCurrency(transfer.amount)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <TransferStatusBadge status={transfer.status} />
                        </td>
                        <td className="px-3 py-3 text-right">
                          {transfer.status === 'PENDING_APPROVAL' ? (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                disabled={actionId === transfer.id}
                                onClick={() => handleApprove(transfer)}
                              >
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={actionId === transfer.id}
                                onClick={() => handleReject(transfer)}
                              >
                                Reject
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelected(transfer)}
                            >
                              View
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 flex items-center justify-between border-t border-white/50 pt-4">
                <p className="text-sm text-muted-foreground">
                  {filtered.length} transfer{filtered.length === 1 ? '' : 's'}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
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
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </GlassCardContent>
      </GlassCard>

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Transfer details</DialogTitle>
          </DialogHeader>
          {selected ? (
            <dl className={cn(glassInset(), 'rounded-xl px-4 py-1 text-sm')}>
              <TransferDetailRow
                label="Beneficiary"
                value={selected.beneficiary_account_name}
              />
              <TransferDetailRow label="Amount">
                <span className="font-semibold tabular-nums">
                  {formatCurrency(selected.amount)}
                </span>
              </TransferDetailRow>
              <TransferDetailRow label="Status">
                <TransferStatusBadge status={selected.status} />
              </TransferDetailRow>
              <TransferDetailRow label="Mode" value={selected.payout_mode} />
              <TransferDetailRow label="Payment ref" value={selected.payout_ref} mono />
              <TransferDetailRow label="UTR" value={transferUtr(selected)} mono />
              <TransferDetailRow label="To account" mono>
                {transferDestination(selected)}
              </TransferDetailRow>
              {selected.transaction_note ? (
                <TransferDetailRow
                  label="Note"
                  value={selected.transaction_note}
                />
              ) : null}
              <TransferDetailRow label="Submitted">
                {formatDate(selected.created_at)}
              </TransferDetailRow>
            </dl>
          ) : null}
        </DialogContent>
      </Dialog>

      <TransferActionDialog
        open={actionDialogOpen}
        mode={actionDialogMode}
        transfer={actionTransfer}
        rejectReason={rejectReason}
        isSubmitting={actionId !== null}
        onRejectReasonChange={setRejectReason}
        onConfirm={() => void confirmTransferAction()}
        onCancel={closeTransferAction}
      />

      <SeriousConfirmDialog
        open={confirmOpen}
        options={confirmOptions}
        onConfirm={() => void runConfirmedAction()}
        onCancel={() => {
          setConfirmOpen(false);
          setConfirmAction(null);
          setConfirmOptions(null);
        }}
      />
    </div>
  );
}
