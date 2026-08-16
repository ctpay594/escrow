import { createdAtInCustomRange } from '@/lib/history-date-range';

export interface AdminHistoryTransfer {
  id: string;
  kind?: 'payout' | 'deposit';
  source?: 'merchant' | 'company';
  batch_id: string | null;
  user_id?: string | null;
  merchant_id?: string | null;
  merchant_name?: string;
  username?: string;
  payout_ref: string;
  amount: number;
  payout_mode?: string;
  beneficiary_account_name: string;
  beneficiary_account_no: string | null;
  beneficiary_ifsc: string | null;
  status: string;
  utr: string | null;
  bank_ref: string | null;
  created_at: string;
  remitter_name?: string | null;
  remitter_account?: string | null;
  virtual_account?: string | null;
}

export type AdminHistoryEntry =
  | { kind: 'deposit'; item: AdminHistoryTransfer }
  | { kind: 'single'; item: AdminHistoryTransfer }
  | {
      kind: 'batch';
      batchId: string;
      created_at: string;
      transfers: AdminHistoryTransfer[];
      totalAmount: number;
    };

function isDepositRow(item: AdminHistoryTransfer) {
  return item.kind === 'deposit' || item.status === 'CREDITED';
}

function entryTimestamp(entry: AdminHistoryEntry) {
  return new Date(
    entry.kind === 'batch' ? entry.created_at : entry.item.created_at,
  ).getTime();
}

export function aggregateBatchStatus(transfers: AdminHistoryTransfer[]): string {
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

export function buildAdminHistoryEntries(
  items: AdminHistoryTransfer[],
): AdminHistoryEntry[] {
  const entries: AdminHistoryEntry[] = [];
  const batchTransfers = new Map<string, AdminHistoryTransfer[]>();

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
    const sorted = [...transfers].sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    entries.push({
      kind: 'batch',
      batchId,
      created_at: sorted[0]?.created_at ?? new Date().toISOString(),
      transfers: sorted,
      totalAmount: Number(
        sorted.reduce((sum, transfer) => sum + transfer.amount, 0).toFixed(2),
      ),
    });
  }

  return entries.sort((a, b) => entryTimestamp(b) - entryTimestamp(a));
}

export function batchDisplayTitle(entry: Extract<AdminHistoryEntry, { kind: 'batch' }>) {
  const count = entry.transfers.length;
  return `Bulk transfer · ${count} payout${count === 1 ? '' : 's'}`;
}

export function entryMatchesSearch(entry: AdminHistoryEntry, query: string) {
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

function transferMatchesSearch(transfer: AdminHistoryTransfer, query: string) {
  const utr = transfer.utr ?? transfer.bank_ref ?? '';

  return (
    transfer.beneficiary_account_name.toLowerCase().includes(query) ||
    transfer.payout_ref.toLowerCase().includes(query) ||
    utr.toLowerCase().includes(query) ||
    (transfer.beneficiary_account_no ?? '').toLowerCase().includes(query) ||
    (transfer.beneficiary_ifsc ?? '').toLowerCase().includes(query) ||
    (transfer.virtual_account ?? '').toLowerCase().includes(query) ||
    (transfer.merchant_name ?? '').toLowerCase().includes(query) ||
    (transfer.username ?? '').toLowerCase().includes(query)
  );
}

export function entryMerchantId(entry: AdminHistoryEntry) {
  if (entry.kind === 'batch') {
    const first = entry.transfers[0];
    if (first && isCompanyRow(first)) {
      return 'company';
    }
    return first?.user_id ?? first?.merchant_id ?? '';
  }

  if (isCompanyRow(entry.item)) {
    return 'company';
  }

  return entry.item.user_id ?? entry.item.merchant_id ?? '';
}

export function entryMerchantLabel(entry: AdminHistoryEntry) {
  const item = entry.kind === 'batch' ? entry.transfers[0] : entry.item;
  if (item && isCompanyRow(item)) {
    return 'Company account';
  }
  return item?.merchant_name || item?.username || 'Unknown merchant';
}

function isCompanyRow(item: AdminHistoryTransfer) {
  return (
    item.source === 'company' ||
    item.username === 'company' ||
    item.merchant_name === 'Company account' ||
    (!item.user_id && !item.merchant_id && item.kind !== 'deposit')
  );
}

export function entryMatchesMerchant(entry: AdminHistoryEntry, merchantId: string) {
  if (!merchantId || merchantId === 'all') {
    return true;
  }

  return entryMerchantId(entry) === merchantId;
}

export function entryMatchesPeriod(
  entry: AdminHistoryEntry,
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

export function entryMatchesType(
  entry: AdminHistoryEntry,
  typeFilter: 'all' | 'payout' | 'deposit' | 'batch',
) {
  if (typeFilter === 'all') {
    return true;
  }

  return entry.kind === typeFilter;
}

export function entryMatchesStatus(entry: AdminHistoryEntry, statusFilter: string) {
  if (statusFilter === 'all') {
    return true;
  }

  if (entry.kind === 'deposit') {
    return statusFilter === 'CREDITED';
  }

  if (entry.kind === 'batch') {
    return aggregateBatchStatus(entry.transfers) === statusFilter;
  }

  if (statusFilter === 'CREDITED') {
    return false;
  }

  if (statusFilter === 'SUCCESS' && isDepositRow(entry.item)) {
    return false;
  }

  return entry.item.status === statusFilter;
}

export function pendingCountInBatch(entry: Extract<AdminHistoryEntry, { kind: 'batch' }>) {
  return entry.transfers.filter((transfer) => transfer.status === 'PENDING_APPROVAL')
    .length;
}
