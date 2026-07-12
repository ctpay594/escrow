'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  EmptyState,
  LoadingBlock,
  SectionCard,
  StatusBadge,
  buttonPrimaryClassName,
  buttonSecondaryClassName,
  formatCurrency,
  formatDate,
  inputClassName,
} from '@/components/ui';

type TransferStatus =
  | 'PENDING_APPROVAL'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'REJECTED';

interface AdminTransfer {
  id: string;
  payout_ref: string;
  amount: number;
  payout_mode: string;
  transaction_note: string | null;
  beneficiary_account_name: string;
  beneficiary_account_no: string | null;
  beneficiary_ifsc: string | null;
  beneficiary_vpa: string | null;
  status: TransferStatus;
  utr: string | null;
  bank_ref: string | null;
  created_at: string;
  user_id: string;
  username: string;
  merchant_name: string;
}

function transferUtr(transfer: AdminTransfer) {
  return transfer.utr ?? transfer.bank_ref ?? null;
}

function transferUtrLabel(transfer: AdminTransfer) {
  return transferUtr(transfer) ?? 'UTR pending';
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'PENDING_APPROVAL', label: 'Pending approval' },
  { value: '', label: 'All statuses' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'SUCCESS', label: 'Completed' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'REJECTED', label: 'Rejected' },
];

function beneficiarySummary(transfer: AdminTransfer): string {
  if (transfer.payout_mode === 'UPI') {
    return transfer.beneficiary_vpa ?? '—';
  }

  return `${transfer.beneficiary_account_no ?? '—'} · ${transfer.beneficiary_ifsc ?? '—'}`;
}

function redirectToLoginIfUnauthorized(response: Response): boolean {
  if (response.status === 401) {
    window.location.href = '/api/auth/logout?redirect=/login';
    return true;
  }

  return false;
}

export function TransfersPanel() {
  const [transfers, setTransfers] = useState<AdminTransfer[]>([]);
  const [statusFilter, setStatusFilter] = useState('PENDING_APPROVAL');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const loadTransfers = useCallback(async () => {
    setError(null);

    try {
      const query = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
      const response = await fetch(`/api/transfers${query}`);
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
  }, [statusFilter]);

  useEffect(() => {
    setIsLoading(true);
    void loadTransfers();
  }, [loadTransfers]);

  useEffect(() => {
    if (!success) {
      return;
    }

    const timer = window.setTimeout(() => setSuccess(null), 6000);
    return () => window.clearTimeout(timer);
  }, [success]);

  async function handleSyncStatus() {
    setIsSyncing(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch('/api/transfers/reconcile-status', {
        method: 'POST',
      });
      const data = await response.json();

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to sync transfer status');
      }

      await loadTransfers();

      if (data.updated > 0) {
        setSuccess(
          `${data.updated} transfer${data.updated === 1 ? '' : 's'} updated with bank status.`,
        );
      } else if (data.stillProcessing > 0) {
        setSuccess(
          `${data.stillProcessing} transfer${data.stillProcessing === 1 ? '' : 's'} still processing at bank.`,
        );
      } else {
        setSuccess('All transfers are up to date.');
      }
    } catch (syncError) {
      setError(
        syncError instanceof Error
          ? syncError.message
          : 'Failed to sync transfer status',
      );
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleApprove(id: string, payoutRef: string) {
    if (
      !window.confirm(
        `Approve transfer ${payoutRef} and submit payout to EscrowStack?`,
      )
    ) {
      return;
    }

    setActionId(id);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/transfers/${id}/approve`, {
        method: 'POST',
      });
      const data = await response.json();

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to approve transfer');
      }

      setSuccess(
        `Transfer ${payoutRef} submitted. UTR sync runs in the background.`,
      );
      await loadTransfers();
    } catch (approveError) {
      setError(
        approveError instanceof Error
          ? approveError.message
          : 'Failed to approve transfer',
      );
    } finally {
      setActionId(null);
    }
  }

  async function handleReject(id: string, payoutRef: string) {
    if (
      !window.confirm(
        `Reject transfer ${payoutRef}? Held funds will be released back to the merchant.`,
      )
    ) {
      return;
    }

    setActionId(id);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/transfers/${id}/reject`, {
        method: 'POST',
      });
      const data = await response.json();

      if (redirectToLoginIfUnauthorized(response)) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.message ?? 'Failed to reject transfer');
      }

      setSuccess(`Transfer ${payoutRef} rejected. Funds released.`);
      await loadTransfers();
    } catch (rejectError) {
      setError(
        rejectError instanceof Error
          ? rejectError.message
          : 'Failed to reject transfer',
      );
    } finally {
      setActionId(null);
    }
  }

  const pendingCount = transfers.filter(
    (transfer) => transfer.status === 'PENDING_APPROVAL',
  ).length;
  const processingCount = transfers.filter(
    (transfer) => transfer.status === 'PROCESSING',
  ).length;

  return (
    <div className="space-y-6">
      {error ? <Alert tone="error">{error}</Alert> : null}
      {success ? <Alert tone="success">{success}</Alert> : null}

      <SectionCard
        title="Transfer queue"
        description="Approve to submit signed payout to EscrowStack. UTR and final status sync automatically after approval."
        action={
          <div className="flex flex-wrap items-center gap-2">
            {pendingCount > 0 ? (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
                {pendingCount} pending
              </span>
            ) : null}
            {processingCount > 0 ? (
              <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-800 ring-1 ring-sky-200">
                {processingCount} at bank
              </span>
            ) : null}
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className={inputClassName()}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value || 'all'} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={isSyncing}
              onClick={() => void handleSyncStatus()}
              className={buttonSecondaryClassName()}
            >
              {isSyncing ? 'Syncing…' : 'Sync status'}
            </button>
            <button
              type="button"
              onClick={() => void loadTransfers()}
              className={buttonSecondaryClassName()}
            >
              Refresh
            </button>
          </div>
        }
      >
        {isLoading ? (
          <LoadingBlock label="Loading transfers..." />
        ) : transfers.length === 0 ? (
          <EmptyState
            title="No transfers"
            description="Nothing in this queue. Try changing the status filter."
          />
        ) : (
          <div className="space-y-4">
            {transfers.map((transfer) => (
              <article
                key={transfer.id}
                className="rounded-xl border border-zinc-200 bg-zinc-50 p-5"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="font-mono text-sm font-medium text-zinc-900">
                        {transfer.payout_ref}
                      </h3>
                      <StatusBadge status={transfer.status} />
                      <span className="text-xs text-zinc-500">
                        {formatDate(transfer.created_at)}
                      </span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                          Merchant
                        </p>
                        <p className="mt-1 text-sm font-medium text-zinc-900">
                          {transfer.merchant_name}
                        </p>
                        <p className="text-xs text-zinc-600">
                          {transfer.username}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                          Amount
                        </p>
                        <p className="mt-1 text-lg font-semibold text-zinc-900">
                          {formatCurrency(transfer.amount)}
                        </p>
                        <p className="text-xs text-zinc-600">
                          {transfer.payout_mode}
                          {transfer.transaction_note
                            ? ` · ${transfer.transaction_note}`
                            : ''}
                        </p>
                      </div>
                      <div className="sm:col-span-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                          Beneficiary
                        </p>
                        <p className="mt-1 text-sm text-zinc-900">
                          {transfer.beneficiary_account_name}
                        </p>
                        <p className="text-xs text-zinc-600">
                          {beneficiarySummary(transfer)}
                        </p>
                      </div>
                      <div className="sm:col-span-2">
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                          Bank reference
                        </p>
                        <p className="mt-1 font-mono text-sm text-zinc-900">
                          {transferUtrLabel(transfer)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {transfer.status === 'PENDING_APPROVAL' ? (
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled={actionId === transfer.id}
                        onClick={() =>
                          void handleApprove(transfer.id, transfer.payout_ref)
                        }
                        className={buttonPrimaryClassName()}
                      >
                        {actionId === transfer.id
                          ? 'Submitting to bank...'
                          : 'Approve'}
                      </button>
                      <button
                        type="button"
                        disabled={actionId === transfer.id}
                        onClick={() =>
                          void handleReject(transfer.id, transfer.payout_ref)
                        }
                        className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
