import * as XLSX from 'xlsx';
import { BULK_UPLOAD_HEADERS } from '@/lib/bulk-transfer';
import { userTransferStatus } from '@/lib/format';
import { payoutModeLabel } from '@/lib/payout-mode';
import { transferUtr } from '@/lib/transfer-display';
import type { TransferItem } from '@/lib/types';

function slugForFilename(value: string) {
  return value
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-_.]/g, '')
    .slice(0, 48);
}

export function exportBatchStatementXlsx(
  transfers: TransferItem[],
  options?: { label?: string | null; batchId?: string },
) {
  const headers = [
    ...BULK_UPLOAD_HEADERS,
    'payment_ref',
    'utr',
    'status',
  ];

  const rows = transfers.map((transfer) => [
    transfer.beneficiary_account_name,
    transfer.beneficiary_account_no ?? '',
    transfer.beneficiary_ifsc ?? '',
    payoutModeLabel(transfer.payout_mode),
    transfer.amount,
    transfer.payout_ref,
    transferUtr(transfer) ?? '',
    userTransferStatus(transfer.status),
  ]);

  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  for (let rowIndex = 1; rowIndex <= transfers.length; rowIndex += 1) {
    const accountCell = XLSX.utils.encode_cell({ r: rowIndex, c: 1 });
    const accountValue = String(transfers[rowIndex - 1]?.beneficiary_account_no ?? '');

    if (accountValue) {
      worksheet[accountCell] = { t: 's', v: accountValue };
    }
  }

  worksheet['!cols'] = [
    { wch: 24 },
    { wch: 20 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 22 },
    { wch: 18 },
    { wch: 14 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Batch statement');

  const labelSlug = options?.label ? slugForFilename(options.label) : 'batch';
  const batchSlug = options?.batchId?.slice(0, 8) ?? 'export';
  const date = new Date().toISOString().slice(0, 10);

  XLSX.writeFile(
    workbook,
    `ctpay-batch-${labelSlug || batchSlug}-${date}.xlsx`,
  );
}
