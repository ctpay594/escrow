import type { TransferItem } from '@/lib/types';
import { formatDate, userTransferStatus } from '@/lib/format';
import { payoutModeLabel } from '@/lib/payout-mode';
import { transferDestination, transferUtr } from '@/lib/transfer-display';
import {
  aggregateBatchStatus,
  batchDisplayTitle,
  type HistoryEntry,
} from '@/lib/history-display';

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

export function buildStatementFilename(
  accountLabel: string,
  periodSlug = 'last-7days',
) {
  const slug = slugForFilename(accountLabel) || 'account';
  return `CTPay-statement-${slug}-${periodSlug}-${statementDate()}.csv`;
}

/** Keeps long numeric IDs readable when opened in Excel (avoids scientific notation). */
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

export function exportTransfersCsv(
  transfers: TransferItem[],
  accountLabel: string,
  periodLabel = 'Last 7 days',
) {
  const headers = [
    'Date',
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
    ['Account', accountLabel],
    ['Period', periodLabel],
    ['Generated', formatDate(new Date().toISOString())],
    [],
  ];

  const rows = transfers.map((t) => statementRowFromTransfer(t));

  const csv = [
    '\uFEFF',
    ...metaRows.map((row) =>
      row.length === 0
        ? ''
        : row
            .map((cell) => csvCell(cell))
            .join(','),
    ),
    headers.map((cell) => csvCell(cell)).join(','),
    ...rows,
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildStatementFilename(
    accountLabel,
    periodLabel.toLowerCase().replace(/\s+/g, '-'),
  );
  link.click();
  URL.revokeObjectURL(url);
}

function statementRowFromTransfer(transfer: TransferItem) {
  return [
    csvCell(formatDate(transfer.created_at)),
    csvCell(transfer.kind === 'deposit' ? 'Deposit' : 'Payout'),
    csvCell(transfer.beneficiary_account_name),
    excelTextCell(transfer.payout_ref),
    excelTextCell(transferUtr(transfer) ?? ''),
    csvCell(payoutModeLabel(transfer.payout_mode)),
    excelTextCell(transfer.beneficiary_account_no ?? ''),
    csvCell(transfer.beneficiary_ifsc ?? ''),
    csvCell(transfer.amount.toFixed(2)),
    csvCell(userTransferStatus(transfer.status)),
  ].join(',');
}

export function exportHistoryEntriesCsv(
  entries: HistoryEntry[],
  accountLabel: string,
  periodLabel = 'Last 7 days',
) {
  const headers = [
    'Date',
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
    ['Account', accountLabel],
    ['Period', periodLabel],
    ['Generated', formatDate(new Date().toISOString())],
    [],
  ];

  const rows = entries.map((entry) => {
    if (entry.kind === 'batch') {
      return [
        csvCell(formatDate(entry.created_at)),
        csvCell('Bulk batch'),
        csvCell(batchDisplayTitle(entry)),
        excelTextCell(entry.batchId.slice(0, 8)),
        csvCell(''),
        csvCell('IMPS'),
        csvCell(''),
        csvCell(''),
        csvCell(entry.totalAmount.toFixed(2)),
        csvCell(userTransferStatus(aggregateBatchStatus(entry.transfers))),
      ].join(',');
    }

    return statementRowFromTransfer(entry.item);
  });

  const csv = [
    '\uFEFF',
    ...metaRows.map((row) =>
      row.length === 0
        ? ''
        : row
            .map((cell) => csvCell(cell))
            .join(','),
    ),
    headers.map((cell) => csvCell(cell)).join(','),
    ...rows,
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildStatementFilename(
    accountLabel,
    periodLabel.toLowerCase().replace(/\s+/g, '-'),
  );
  link.click();
  URL.revokeObjectURL(url);
}

export function buildTransferReceiptText(transfer: TransferItem) {
  const utr = transferUtr(transfer) ?? '—';
  const destination = transferDestination(transfer);

  return [
    'CTPay Transfer Receipt',
    '----------------------',
    `Date: ${formatDate(transfer.created_at)}`,
    `Beneficiary: ${transfer.beneficiary_account_name}`,
    `Amount: ${transfer.amount.toFixed(2)} INR`,
    `Mode: ${transfer.payout_mode ?? 'IMPS'}`,
    `Payment ref: ${transfer.payout_ref}`,
    `UTR: ${utr}`,
    `To account: ${destination}`,
    transfer.transaction_note ? `Note: ${transfer.transaction_note}` : null,
    `Status: ${userTransferStatus(transfer.status)}`,
  ]
    .filter(Boolean)
    .join('\n');
}
