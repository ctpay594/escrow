-- Merchant portal access status (active / on_hold / terminated)

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'active'
  CHECK (account_status IN ('active', 'on_hold', 'terminated'));

CREATE INDEX IF NOT EXISTS merchants_account_status_idx
  ON public.merchants (account_status);
