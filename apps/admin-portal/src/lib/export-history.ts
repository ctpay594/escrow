import { formatDate } from '@/lib/format';
import {
  aggregateBatchStatus,
  batchDisplayTitle,
  entryMerchantLabel,
  type AdminHistoryEntry,
  type AdminHistoryTransfer,
} from '@/lib/history-display';
import { transferStatusLabel } from '@/lib/transfer-status';

function statementDate() {
  return new Date().toISOString().slice(0, 10);
}

function slugForFilename(value: string) {
  return value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-_]/g, '')
    .slice(0, 40);
}

function excelTextCell(value: string) {
  if (!value) {
    return '""';
  }

  const escaped = value.replaceAll('"', '""');
  return `"=""${escaped}"""`;
}

function csvCell(value: string | number) {
  const text = String(value).replaceAll('"', '""');
  return `"${text}"`;
}

function transferUtr(transfer: AdminHistoryTransfer) {
  if (transfer.status === 'FAILED' || transfer.status === 'REJECTED') {
    return '';
  }

  return transfer.utr ?? '';
}

function statementRowFromTransfer(transfer: AdminHistoryTransfer) {
  return [
    csvCell(formatDate(transfer.created_at)),
    csvCell(transfer.merchant_name || transfer.username || '—'),
    csvCell(transfer.kind === 'deposit' ? 'Deposit' : 'Payout'),
    csvCell(transfer.beneficiary_account_name),
    excelTextCell(transfer.payout_ref),
    excelTextCell(transferUtr(transfer)),
    csvCell(transfer.payout_mode ?? 'IMPS'),
    excelTextCell(transfer.beneficiary_account_no ?? ''),
    csvCell(transfer.beneficiary_ifsc ?? ''),
    csvCell(transfer.amount.toFixed(2)),
    csvCell(transferStatusLabel(transfer.status)),
  ].join(',');
}

export function exportAdminHistoryCsv(
  entries: AdminHistoryEntry[],
  options: {
    merchantLabel: string;
    periodLabel: string;
    typeLabel: string;
    statusLabel: string;
  },
) {
  const headers = [
    'Date',
    'Merchant',
    'Type',
    'Party',
    'Payment Ref',
    'UTR',
    'Mode',
    'Account',
    'IFSC',
    'Amount (INR)',
    'Status',
  ];

  const metaRows = [
    ['Merchant', options.merchantLabel],
    ['Period', options.periodLabel],
    ['Type', options.typeLabel],
    ['Status', options.statusLabel],
    ['Generated', formatDate(new Date().toISOString())],
    [],
  ];

  const rows = entries.map((entry) => {
    if (entry.kind === 'batch') {
      return [
        csvCell(formatDate(entry.created_at)),
        csvCell(entryMerchantLabel(entry)),
        csvCell('Bulk batch'),
        csvCell(batchDisplayTitle(entry)),
        excelTextCell(entry.batchId.slice(0, 8)),
        csvCell(''),
        csvCell(
          [...new Set(entry.transfers.map((transfer) => transfer.payout_mode ?? 'IMPS'))].join(
            '/',
          ),
        ),
        csvCell(''),
        csvCell(''),
        csvCell(entry.totalAmount.toFixed(2)),
        csvCell(transferStatusLabel(aggregateBatchStatus(entry.transfers))),
      ].join(',');
    }

    return statementRowFromTransfer(entry.item);
  });

  const csv = [
    '\uFEFF',
    ...metaRows.map((row) =>
      row.length === 0 ? '' : row.map((cell) => csvCell(cell)).join(','),
    ),
    headers.map((cell) => csvCell(cell)).join(','),
    ...rows,
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const merchantSlug = slugForFilename(options.merchantLabel) || 'all-merchants';
  const periodSlug = options.periodLabel.toLowerCase().replace(/\s+/g, '-');
  link.href = url;
  link.download = `CTPay-admin-statement-${merchantSlug}-${periodSlug}-${statementDate()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
