export type TransferStatus =
  | 'PENDING_APPROVAL'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'REJECTED';

export type PayoutMode = 'IMPS' | 'NEFT' | 'RTGS' | 'UPI';

export type TransferSource = 'merchant' | 'company';

export interface TransferRecord {
  id: string;
  user_id: string | null;
  merchant_id: string | null;
  source: TransferSource;
  batch_id: string | null;
  payout_ref: string;
  amount: number;
  payout_mode: PayoutMode;
  transaction_note: string | null;
  beneficiary_account_name: string;
  beneficiary_account_no: string | null;
  beneficiary_ifsc: string | null;
  beneficiary_vpa: string | null;
  payee_user_ref: string | null;
  payee_user_name: string | null;
  status: TransferStatus;
  utr: string | null;
  bank_ref: string | null;
  escrow_response: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface PublicTransfer {
  id: string;
  batch_id: string | null;
  source: TransferSource;
  payout_ref: string;
  amount: number;
  payout_mode: PayoutMode;
  transaction_note: string | null;
  beneficiary_account_name: string;
  beneficiary_account_no: string | null;
  beneficiary_ifsc: string | null;
  beneficiary_vpa: string | null;
  status: TransferStatus;
  utr: string | null;
  bank_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCompanyTransferInput {
  amount: number;
  payoutMode: PayoutMode;
  transactionNote?: string;
  beneficiaryAccountName: string;
  beneficiaryAccountNo?: string;
  beneficiaryIfsc?: string;
  beneficiaryVpa?: string;
}

export interface CreateTransferInput {
  userId: string;
  amount: number;
  payoutMode: PayoutMode;
  transactionNote?: string;
  beneficiaryAccountName: string;
  beneficiaryAccountNo?: string;
  beneficiaryIfsc?: string;
  beneficiaryVpa?: string;
}

export interface AdminTransferListItem extends PublicTransfer {
  user_id: string | null;
  merchant_id: string | null;
  merchant_name: string;
  username: string;
  payee_user_ref: string | null;
  payee_user_name: string | null;
  escrow_response: Record<string, unknown> | null;
}

export interface ReconcileTransfersResult {
  checked: number;
  updated: number;
  stillProcessing: number;
  transfers: PublicTransfer[];
  /** Lower bound used for incremental SUCCESS/missing-UTR scan */
  since?: string | null;
  watermarkAdvancedTo?: string | null;
}

export interface TransferBatchSummary {
  id: string;
  label: string | null;
  total_amount: number;
  transfer_count: number;
  created_at: string;
}

export interface BulkTransferResult {
  batch: TransferBatchSummary;
  transfers: PublicTransfer[];
  total_amount: number;
  transfer_count: number;
}

export interface ApproveBatchResult {
  batch_id: string;
  approved: number;
  failed: { transfer_id: string; payout_ref: string; message: string }[];
  transfers: PublicTransfer[];
}

export interface UserTransfersListResult {
  transfers: PublicTransfer[];
  batches: TransferBatchSummary[];
}

/** Same rules as admin analytics: deposits = in, SUCCESS payouts = out (IST days). */
export interface MerchantVolumeBucket {
  in_amount: number;
  in_count: number;
  out_amount: number;
  out_count: number;
}

export interface MerchantVolumeDay extends MerchantVolumeBucket {
  date: string;
}

export interface MerchantVolumeResult {
  days: MerchantVolumeDay[];
  week: MerchantVolumeBucket;
  awaiting_approval: number;
  processing: number;
  period: {
    today: string;
    week_from: string;
    days_from: string;
  };
  generated_at: string;
}
