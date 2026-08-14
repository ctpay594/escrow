import type { DepositItem, TransferItem } from '@/lib/types';

export function isDepositRow(row: TransferItem) {
  return row.kind === 'deposit' || row.status === 'CREDITED';
}

export function depositToHistoryRow(deposit: DepositItem): TransferItem {
  return {
    id: deposit.id,
    kind: 'deposit',
    batch_id: null,
    payout_ref: deposit.utr || deposit.virtual_account,
    amount: Number(deposit.amount),
    payout_mode: 'COLLECT',
    transaction_note: deposit.remitter_name,
    beneficiary_account_name: deposit.remitter_name || 'Incoming deposit',
    beneficiary_account_no: deposit.remitter_account,
    beneficiary_ifsc: null,
    beneficiary_vpa: null,
    status: 'CREDITED',
    utr: deposit.utr,
    bank_ref: deposit.virtual_account,
    created_at: deposit.created_at,
    remitter_name: deposit.remitter_name,
    remitter_account: deposit.remitter_account,
    virtual_account: deposit.virtual_account,
  };
}
