import type { TransferItem } from '@/lib/types';
import { formatDate, userTransferStatus } from '@/lib/format';
import { transferDestination, transferUtr } from '@/lib/transfer-display';

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

export function buildStatementFilename(accountLabel: string) {
  const slug = slugForFilename(accountLabel) || 'account';
  return `CTPay-statement-${slug}-last-48hrs-${statementDate()}.csv`;
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
) {
  const headers = [
    'Date',
    'Beneficiary',
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
    ['Period', 'Last 48 hours'],
    ['Generated', formatDate(new Date().toISOString())],
    [],
  ];

  const rows = transfers.map((t) =>
    [
      csvCell(formatDate(t.created_at)),
      csvCell(t.beneficiary_account_name),
      excelTextCell(t.payout_ref),
      excelTextCell(transferUtr(t) ?? ''),
      csvCell(t.payout_mode ?? 'IMPS'),
      excelTextCell(t.beneficiary_account_no ?? ''),
      csvCell(t.beneficiary_ifsc ?? ''),
      csvCell(t.amount.toFixed(2)),
      csvCell(userTransferStatus(t.status)),
    ].join(','),
  );

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
  link.download = buildStatementFilename(accountLabel);
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
