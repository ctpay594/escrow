export interface MerchantRecord {
  id: string;
  user_id: string;
  merchant_name: string;
  user_ref: string | null;
  virtual_account_no: string | null;
  escrow_ifsc: string | null;
  available_balance: number;
  real_balance: number;
  demo_balance: number;
  pending_balance: number;
  escrow_account_details: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export type MerchantAccountStatus = 'active' | 'on_hold' | 'terminated';

export interface PublicMerchantProfile {
  merchant_name: string;
  user_ref: string | null;
  virtual_account_no: string | null;
  escrow_ifsc: string | null;
  available_balance: number;
  pending_balance: number;
  load_instructions: Record<string, string[]> | null;
  account_status: MerchantAccountStatus;
}

export interface MerchantProfileRow {
  merchant_name: string;
  user_ref: string | null;
  virtual_account_no: string | null;
  escrow_ifsc: string | null;
  available_balance: number;
  pending_balance: number;
  escrow_account_details: Record<string, unknown> | null;
}

export interface AdminMerchantListItem {
  id: string;
  username: string;
  password: string;
  merchant_name: string;
  user_ref: string | null;
  virtual_account_no: string | null;
  escrow_ifsc: string | null;
  available_balance: number;
  real_balance: number;
  demo_balance: number;
  pending_balance: number;
  balance_mode: 'real' | 'demo';
  account_status: MerchantAccountStatus;
  created_at: string;
  updated_at: string;
}

export interface PublicDeposit {
  id: string;
  amount: number;
  utr: string | null;
  virtual_account: string;
  remitter_name: string | null;
  remitter_account: string | null;
  created_at: string;
}

export interface AdminDepositListItem extends PublicDeposit {
  user_id: string | null;
  merchant_id: string | null;
}

export interface CreateMerchantInput {
  userId: string;
  merchantName: string;
  userRef?: string;
  virtualAccountNo?: string;
  escrowIfsc?: string;
  realBalance: number;
  demoBalance: number;
  escrowAccountDetails: Record<string, unknown>;
}
