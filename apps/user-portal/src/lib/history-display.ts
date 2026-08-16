import { isDepositRow } from '@/lib/deposit-display';
import { createdAtInCustomRange } from '@/lib/history-date-range';
import type { TransferItem } from '@/lib/types';
import { transferUtr } from '@/lib/transfer-display';

export interface TransferBatchMeta {
  id: string;
  label: string | null;
  total_amount: number;
  transfer_count: number;
  created_at: string;
}

export type HistoryEntry =
  | { kind: 'deposit'; item: TransferItem }
  | { kind: 'single'; item: TransferItem }
  | {
      kind: 'batch';
      batchId: string;
      label: string | null;
      created_at: string;
      transfers: TransferItem[];
      totalAmount: number;
    };

export function parseUserTransfersResponse(data: unknown): {
  transfers: TransferItem[];
  batches: Map<string, TransferBatchMeta>;
} {
  if (Array.isArray(data)) {
    return { transfers: data as TransferItem[], batches: new Map() };
  }

  if (
    data &&
    typeof data === 'object' &&
    Array.isArray((data as { transfers?: unknown }).transfers)
  ) {
    const payload = data as {
      transfers: TransferItem[];
      batches?: TransferBatchMeta[];
    };
    const batches = new Map<string, TransferBatchMeta>();

    for (const batch of payload.batches ?? []) {
      batches.set(batch.id, batch);
    }

    return { transfers: payload.transfers, batches };
  }

  return { transfers: [], batches: new Map() };
}

function entryTimestamp(entry: HistoryEntry) {
  return new Date(
    entry.kind === 'batch' ? entry.created_at : entry.item.created_at,
  ).getTime();
}

export function aggregateBatchStatus(transfers: TransferItem[]): string {
  const statuses = transfers.map((transfer) => transfer.status);

  if (statuses.some((status) => status === 'PROCESSING')) {
    return 'PROCESSING';
  }

  if (statuses.some((status) => status === 'PENDING_APPROVAL')) {
    return 'PENDING_APPROVAL';
  }

  if (statuses.some((status) => status === 'FAILED')) {
    return 'FAILED';
  }

  if (statuses.some((status) => status === 'REJECTED')) {
    return 'REJECTED';
  }

  return 'SUCCESS';
}

export function buildHistoryEntries(
  items: TransferItem[],
  batches: Map<string, TransferBatchMeta>,
): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  const batchTransfers = new Map<string, TransferItem[]>();

  for (const item of items) {
    if (isDepositRow(item)) {
      entries.push({ kind: 'deposit', item });
      continue;
    }

    if (item.batch_id) {
      const list = batchTransfers.get(item.batch_id) ?? [];
      list.push(item);
      batchTransfers.set(item.batch_id, list);
      continue;
    }

    entries.push({ kind: 'single', item });
  }

  for (const [batchId, transfers] of batchTransfers) {
    const meta = batches.get(batchId);
    const sorted = [...transfers].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    entries.push({
      kind: 'batch',
      batchId,
      label: meta?.label ?? null,
      created_at: meta?.created_at ?? sorted[0]?.created_at ?? new Date().toISOString(),
      transfers: sorted,
      totalAmount:
        meta?.total_amount ??
        Number(sorted.reduce((sum, transfer) => sum + transfer.amount, 0).toFixed(2)),
    });
  }

  return entries.sort((a, b) => entryTimestamp(b) - entryTimestamp(a));
}

export function batchDisplayTitle(entry: Extract<HistoryEntry, { kind: 'batch' }>) {
  const count = entry.transfers.length;

  if (entry.label?.trim()) {
    return entry.label.trim();
  }

  return `Bulk transfer · ${count} payout${count === 1 ? '' : 's'}`;
}

export function entryMatchesSearch(entry: HistoryEntry, query: string) {
  if (!query) {
    return true;
  }

  const normalized = query.toLowerCase();

  if (entry.kind === 'batch') {
    if (batchDisplayTitle(entry).toLowerCase().includes(normalized)) {
      return true;
    }

    if (entry.batchId.toLowerCase().includes(normalized)) {
      return true;
    }

    return entry.transfers.some((transfer) =>
      transferMatchesSearch(transfer, normalized),
    );
  }

  return transferMatchesSearch(entry.item, normalized);
}

function transferMatchesSearch(transfer: TransferItem, query: string) {
  const utr = transferUtr(transfer) ?? '';

  return (
    transfer.beneficiary_account_name.toLowerCase().includes(query) ||
    transfer.payout_ref.toLowerCase().includes(query) ||
    utr.toLowerCase().includes(query) ||
    (transfer.beneficiary_account_no ?? '').toLowerCase().includes(query) ||
    (transfer.beneficiary_ifsc ?? '').toLowerCase().includes(query) ||
    (transfer.virtual_account ?? '').toLowerCase().includes(query)
  );
}

export function entryMatchesStatus(entry: HistoryEntry, statusFilter: string) {
  if (statusFilter === 'all') {
    return true;
  }

  if (entry.kind === 'deposit') {
    return statusFilter === 'CREDITED';
  }

  if (entry.kind === 'batch') {
    const status = aggregateBatchStatus(entry.transfers);

    if (statusFilter === 'processing') {
      return status === 'PENDING_APPROVAL' || status === 'PROCESSING';
    }

    return status === statusFilter;
  }

  if (statusFilter === 'processing') {
    return (
      entry.item.status === 'PENDING_APPROVAL' ||
      entry.item.status === 'PROCESSING'
    );
  }

  if (statusFilter === 'CREDITED') {
    return false;
  }

  if (statusFilter === 'SUCCESS' && isDepositRow(entry.item)) {
    return false;
  }

  return entry.item.status === statusFilter;
}

export function entryMatchesPeriod(
  entry: HistoryEntry,
  period: '48h' | '7d' | '30d' | 'all' | 'custom',
  range?: { from: string; to: string },
) {
  if (period === 'all') {
    return true;
  }

  const createdAt =
    entry.kind === 'batch' ? entry.created_at : entry.item.created_at;

  if (range?.from && range?.to) {
    return createdAtInCustomRange(createdAt, range.from, range.to);
  }

  const windowMs =
    period === '48h'
      ? 48 * 60 * 60 * 1000
      : period === '30d'
        ? 30 * 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;

  return Date.now() - new Date(createdAt).getTime() <= windowMs;
}

export function flattenEntriesForStatement(entries: HistoryEntry[]): TransferItem[] {
  const rows: TransferItem[] = [];

  for (const entry of entries) {
    if (entry.kind === 'batch') {
      rows.push(...entry.transfers);
      continue;
    }

    rows.push(entry.item);
  }

  return rows;
}
