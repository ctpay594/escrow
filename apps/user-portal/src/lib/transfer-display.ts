import type { TransferItem } from '@/lib/types';

export function transferUtr(transfer: TransferItem) {
  if (transfer.status === 'FAILED' || transfer.status === 'REJECTED') {
    return null;
  }

  return transfer.utr ?? null;
}

export function transferDestination(transfer: TransferItem): string {
  if (transfer.payout_mode === 'UPI') {
    return transfer.beneficiary_vpa ?? '—';
  }

  const account = transfer.beneficiary_account_no ?? '—';
  const ifsc = transfer.beneficiary_ifsc ?? '—';
  return `${account} · ${ifsc}`;
}
