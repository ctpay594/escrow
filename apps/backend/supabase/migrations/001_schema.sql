-- CTPay current schema (safe to re-run).
-- Supabase → SQL Editor → paste this whole file → Run.
-- Does not delete merchants, balances, or transfers.

-- ========== users ==========
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_username_unique UNIQUE (username)
);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE public.users DROP COLUMN IF EXISTS password_hash;

CREATE INDEX IF NOT EXISTS users_username_idx ON public.users (username);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON public.users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_users_updated_at();

-- ========== admins ==========
CREATE TABLE IF NOT EXISTS public.admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admins_username_unique UNIQUE (username)
);

ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE public.admins DROP COLUMN IF EXISTS password_hash;

CREATE INDEX IF NOT EXISTS admins_username_idx ON public.admins (username);
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_admins_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admins_set_updated_at ON public.admins;
CREATE TRIGGER admins_set_updated_at
  BEFORE UPDATE ON public.admins
  FOR EACH ROW
  EXECUTE FUNCTION public.set_admins_updated_at();

-- ========== merchants ==========
CREATE TABLE IF NOT EXISTS public.merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  merchant_name TEXT NOT NULL,
  user_ref TEXT,
  virtual_account_no TEXT,
  escrow_ifsc TEXT,
  available_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  pending_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  real_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  demo_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  balance_mode TEXT NOT NULL DEFAULT 'demo',
  approval_mode TEXT NOT NULL DEFAULT 'manual',
  account_status TEXT NOT NULL DEFAULT 'active',
  escrow_account_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS merchant_name TEXT,
  ADD COLUMN IF NOT EXISTS user_ref TEXT,
  ADD COLUMN IF NOT EXISTS virtual_account_no TEXT,
  ADD COLUMN IF NOT EXISTS escrow_ifsc TEXT,
  ADD COLUMN IF NOT EXISTS available_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS real_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS demo_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_mode TEXT NOT NULL DEFAULT 'demo',
  ADD COLUMN IF NOT EXISTS approval_mode TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS escrow_account_details JSONB;

-- Keys live in backend .env only
ALTER TABLE public.merchants
  DROP COLUMN IF EXISTS encrypted_api_key,
  DROP COLUMN IF EXISTS encrypted_private_key;

UPDATE public.merchants
SET
  real_balance = available_balance,
  demo_balance = available_balance
WHERE real_balance = 0 AND demo_balance = 0 AND available_balance <> 0;

UPDATE public.merchants
SET
  balance_mode = COALESCE(balance_mode, 'demo'),
  approval_mode = COALESCE(approval_mode, 'manual'),
  account_status = COALESCE(account_status, 'active');

ALTER TABLE public.merchants DROP CONSTRAINT IF EXISTS merchants_balance_mode_check;
ALTER TABLE public.merchants
  ADD CONSTRAINT merchants_balance_mode_check
  CHECK (balance_mode IN ('demo', 'real'));

ALTER TABLE public.merchants DROP CONSTRAINT IF EXISTS merchants_account_status_check;
ALTER TABLE public.merchants
  ADD CONSTRAINT merchants_account_status_check
  CHECK (account_status IN ('active', 'on_hold', 'terminated'));

ALTER TABLE public.merchants DROP CONSTRAINT IF EXISTS merchants_approval_mode_check;
ALTER TABLE public.merchants
  ADD CONSTRAINT merchants_approval_mode_check
  CHECK (approval_mode IN ('auto', 'manual'));

CREATE INDEX IF NOT EXISTS merchants_user_id_idx ON public.merchants (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS merchants_virtual_account_no_unique
  ON public.merchants (virtual_account_no)
  WHERE virtual_account_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS merchants_account_status_idx
  ON public.merchants (account_status);

ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_merchants_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS merchants_set_updated_at ON public.merchants;
CREATE TRIGGER merchants_set_updated_at
  BEFORE UPDATE ON public.merchants
  FOR EACH ROW
  EXECUTE FUNCTION public.set_merchants_updated_at();

-- ========== transfer_batches + transfers ==========
CREATE TABLE IF NOT EXISTS public.transfer_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  merchant_id UUID REFERENCES public.merchants(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'merchant',
  label TEXT,
  total_amount NUMERIC(18, 2) NOT NULL,
  transfer_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  merchant_id UUID REFERENCES public.merchants(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'merchant',
  payout_ref TEXT NOT NULL UNIQUE,
  amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0),
  payout_mode TEXT NOT NULL CHECK (payout_mode IN ('IMPS', 'NEFT', 'RTGS', 'UPI')),
  transaction_note TEXT,
  beneficiary_account_name TEXT NOT NULL,
  beneficiary_account_no TEXT,
  beneficiary_ifsc TEXT,
  beneficiary_vpa TEXT,
  payee_user_ref TEXT,
  payee_user_name TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING_APPROVAL'
    CHECK (status IN ('PENDING_APPROVAL', 'PROCESSING', 'SUCCESS', 'FAILED', 'REJECTED')),
  escrow_response JSONB,
  utr TEXT,
  bank_ref TEXT,
  batch_id UUID REFERENCES public.transfer_batches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.transfers
  ADD COLUMN IF NOT EXISTS utr TEXT,
  ADD COLUMN IF NOT EXISTS bank_ref TEXT,
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.transfer_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'merchant';

ALTER TABLE public.transfer_batches
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'merchant';

ALTER TABLE public.transfers ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.transfers ALTER COLUMN merchant_id DROP NOT NULL;
ALTER TABLE public.transfer_batches ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.transfer_batches ALTER COLUMN merchant_id DROP NOT NULL;

ALTER TABLE public.transfers DROP CONSTRAINT IF EXISTS transfers_source_check;
ALTER TABLE public.transfers
  ADD CONSTRAINT transfers_source_check
  CHECK (source IN ('merchant', 'company'));

ALTER TABLE public.transfer_batches DROP CONSTRAINT IF EXISTS transfer_batches_source_check;
ALTER TABLE public.transfer_batches
  ADD CONSTRAINT transfer_batches_source_check
  CHECK (source IN ('merchant', 'company'));

CREATE INDEX IF NOT EXISTS transfers_user_id_idx ON public.transfers (user_id);
CREATE INDEX IF NOT EXISTS transfers_merchant_id_idx ON public.transfers (merchant_id);
CREATE INDEX IF NOT EXISTS transfers_status_idx ON public.transfers (status);
CREATE INDEX IF NOT EXISTS transfers_created_at_idx ON public.transfers (created_at DESC);
CREATE INDEX IF NOT EXISTS transfers_utr_idx ON public.transfers (utr) WHERE utr IS NOT NULL;
CREATE INDEX IF NOT EXISTS transfers_batch_id_idx ON public.transfers (batch_id);
CREATE INDEX IF NOT EXISTS transfer_batches_user_id_idx ON public.transfer_batches (user_id);

ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_transfers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS transfers_set_updated_at ON public.transfers;
CREATE TRIGGER transfers_set_updated_at
  BEFORE UPDATE ON public.transfers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_transfers_updated_at();

-- ========== webhook logs ==========
CREATE TABLE IF NOT EXISTS public.callbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_ip TEXT,
  body JSONB NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  process_result TEXT
);

ALTER TABLE public.callbacks
  ADD COLUMN IF NOT EXISTS processed BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS process_result TEXT;

CREATE INDEX IF NOT EXISTS callbacks_received_at_idx
  ON public.callbacks (received_at DESC);

CREATE TABLE IF NOT EXISTS public.deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  callback_id UUID REFERENCES public.callbacks(id) ON DELETE SET NULL,
  merchant_id UUID REFERENCES public.merchants(id) ON DELETE SET NULL,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  virtual_account TEXT NOT NULL,
  amount NUMERIC(18, 2) NOT NULL,
  utr TEXT,
  dedupe_key TEXT NOT NULL,
  remitter_name TEXT,
  remitter_account TEXT,
  debit_credit TEXT NOT NULL DEFAULT 'Credit',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS deposits_dedupe_key_unique
  ON public.deposits (dedupe_key);
CREATE INDEX IF NOT EXISTS deposits_virtual_account_idx
  ON public.deposits (virtual_account);
CREATE INDEX IF NOT EXISTS deposits_user_id_idx
  ON public.deposits (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'escrowstack',
  event_type TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  payout_ref TEXT,
  merchant_id UUID REFERENCES public.merchants(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  remote_ip TEXT,
  user_agent TEXT,
  request_headers JSONB,
  signature_valid BOOLEAN,
  processed BOOLEAN NOT NULL DEFAULT false,
  process_result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  merchant_id UUID REFERENCES public.merchants(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount NUMERIC(18, 2) NOT NULL,
  reason TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  note TEXT,
  real_before NUMERIC(18, 2),
  real_after NUMERIC(18, 2),
  pending_before NUMERIC(18, 2),
  pending_after NUMERIC(18, 2),
  available_after NUMERIC(18, 2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_reason_ref_unique
  ON public.ledger_entries (reason, ref_id);
CREATE INDEX IF NOT EXISTS ledger_entries_user_id_idx
  ON public.ledger_entries (user_id, created_at DESC);

-- Lock the merchant row, then add to collected. Stops two deposits at the
-- same instant from overwriting each other (lost update).
CREATE OR REPLACE FUNCTION public.credit_merchant_collected(
  p_user_id uuid,
  p_amount numeric
)
RETURNS TABLE (
  real_before numeric,
  real_after numeric,
  pending_balance numeric,
  demo_balance numeric,
  balance_mode text
)
LANGUAGE plpgsql
AS $$
DECLARE
  locked public.merchants%ROWTYPE;
  next_real numeric;
  next_available numeric;
BEGIN
  SELECT * INTO locked
  FROM public.merchants
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'merchant not found';
  END IF;

  next_real := ROUND(COALESCE(locked.real_balance, 0) + p_amount, 2);

  IF COALESCE(locked.balance_mode, 'demo') = 'real' THEN
    next_available := GREATEST(next_real - COALESCE(locked.pending_balance, 0), 0);
  ELSE
    next_available := COALESCE(locked.demo_balance, 0);
  END IF;

  UPDATE public.merchants
  SET
    real_balance = next_real,
    available_balance = next_available
  WHERE id = locked.id;

  RETURN QUERY
  SELECT
    COALESCE(locked.real_balance, 0),
    next_real,
    COALESCE(locked.pending_balance, 0),
    COALESCE(locked.demo_balance, 0),
    COALESCE(locked.balance_mode, 'demo');
END;
$$;

-- Watermarks so reconcile jobs only scan since last good check.
CREATE TABLE IF NOT EXISTS public.system_watermarks (
  key TEXT PRIMARY KEY,
  checked_at TIMESTAMPTZ NOT NULL,
  meta JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ========== bank statement sync (HDFC recon) ==========
CREATE TABLE IF NOT EXISTS public.bank_statement_syncs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_date DATE NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('cron', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  ref_user_no TEXT,
  credit_lines INT NOT NULL DEFAULT 0,
  deposits_added INT NOT NULL DEFAULT 0,
  deposits_skipped INT NOT NULL DEFAULT 0,
  unmatched_credits INT NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS bank_statement_syncs_sync_date_idx
  ON public.bank_statement_syncs (sync_date DESC);
CREATE INDEX IF NOT EXISTS bank_statement_syncs_started_at_idx
  ON public.bank_statement_syncs (started_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  payload JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_notifications_created_at_idx
  ON public.admin_notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_notifications_unread_idx
  ON public.admin_notifications (created_at DESC)
  WHERE read_at IS NULL;
