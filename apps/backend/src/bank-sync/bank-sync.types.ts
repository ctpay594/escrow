export const BANK_STATEMENT_WATERMARK_KEY = 'bank_statement_last_synced_date';

export interface BankStatementRow {
  TransactionDate?: string;
  TransactionTime?: string;
  TransactionDescription?: string;
  TransactionAmount?: string;
  Debit_Credit?: string;
  ReferenceNo?: string;
  ValueDate?: string;
  TransactionBranch?: string;
  RunningBalance?: string;
}

export interface BankSyncAddedDeposit {
  utr: string | null;
  amount: number;
  merchant_name: string;
  virtual_account: string;
  description: string;
}

export interface BankSyncUnmatchedCredit {
  utr: string | null;
  amount: number;
  description: string;
  reason: string;
}

export interface BankSyncRunResult {
  sync_date: string;
  trigger_type: 'cron' | 'manual';
  status: 'completed' | 'failed';
  credit_lines: number;
  deposits_added: number;
  deposits_skipped: number;
  unmatched_credits: number;
  added: BankSyncAddedDeposit[];
  unmatched: BankSyncUnmatchedCredit[];
  error_message?: string;
}

export interface BankSyncStatus {
  last_synced_date: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  unread_notifications: number;
  is_running: boolean;
}
