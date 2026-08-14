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
  account_status = COALESCE(account_status, 'active');

ALTER TABLE public.merchants DROP CONSTRAINT IF EXISTS merchants_balance_mode_check;
ALTER TABLE public.merchants
  ADD CONSTRAINT merchants_balance_mode_check
  CHECK (balance_mode IN ('demo', 'real'));

ALTER TABLE public.merchants DROP CONSTRAINT IF EXISTS merchants_account_status_check;
ALTER TABLE public.merchants
  ADD CONSTRAINT merchants_account_status_check
  CHECK (account_status IN ('active', 'on_hold', 'terminated'));

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
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  label TEXT,
  total_amount NUMERIC(18, 2) NOT NULL,
  transfer_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
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
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.transfer_batches(id) ON DELETE SET NULL;

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
