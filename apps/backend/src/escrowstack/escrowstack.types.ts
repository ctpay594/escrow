export interface EscrowBalanceResult {
  /** Spendable / clear balance (HDFC `clear_balance` / `balance`). */
  balance: number;
  /** HDFC `avaliable_balance` = clear + hold (total book figure). */
  totalBalance?: number;
  availableBalance?: number;
  holdAmount?: number;
  lienAmount?: number;
  unclearAmount?: number;
  ledgerBalance?: number;
  accountNo?: string;
  customerId?: string;
  raw: Record<string, unknown>;
}

export interface PayoutBeneficiary {
  account_name: string;
  account_no?: string;
  ifsc?: string;
  vpa?: string;
}

export interface PayoutItem {
  payout_ref: string;
  amount: number;
  payout_mode: string;
  transaction_note?: string;
  payee: {
    user_ref: string;
    user_name: string;
  };
  beneficiary: PayoutBeneficiary;
}

export interface PayoutSubmitResult {
  raw: Record<string, unknown>;
}

export interface PayoutStatusEntry {
  payout_ref: string;
  status: string;
  utr?: string;
  bank_ref?: string;
  raw: Record<string, unknown>;
}

export interface PayoutStatusQuery {
  payoutRef: string;
  txnDate: string;
  mode: string;
}

export interface PayoutStatusResult {
  entries: PayoutStatusEntry[];
  raw: Record<string, unknown>;
}
