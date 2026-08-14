export interface TransferItem {
  id: string;
  kind?: 'payout' | 'deposit';
  batch_id: string | null;
  payout_ref: string;
  amount: number;
  payout_mode: string;
  transaction_note: string | null;
  beneficiary_account_name: string;
  beneficiary_account_no: string | null;
  beneficiary_ifsc: string | null;
  beneficiary_vpa: string | null;
  status: string;
  utr: string | null;
  bank_ref: string | null;
  created_at: string;
  remitter_name?: string | null;
  remitter_account?: string | null;
  virtual_account?: string | null;
}

export interface DepositItem {
  id: string;
  amount: number;
  utr: string | null;
  virtual_account: string;
  remitter_name: string | null;
  remitter_account: string | null;
  created_at: string;
}

export interface MerchantProfile {
  merchant_name: string;
  user_ref: string | null;
  virtual_account_no: string | null;
  escrow_ifsc: string | null;
  available_balance: number;
  pending_balance: number;
  load_instructions: Record<string, string[]> | null;
  account_status: MerchantAccountStatus;
}

export type MerchantAccountStatus = 'active' | 'on_hold' | 'terminated';

export interface SessionUser {
  id: string;
  username: string;
}
