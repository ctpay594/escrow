-- Real balance = live EscrowStack balance (admin view)
-- Demo balance = amount shown to merchant on user portal
-- balance_mode = which balance the merchant portal displays

ALTER TABLE public.merchants
  ADD COLUMN IF NOT EXISTS real_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS demo_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_mode TEXT NOT NULL DEFAULT 'demo';

ALTER TABLE public.merchants
  DROP CONSTRAINT IF EXISTS merchants_balance_mode_check;

ALTER TABLE public.merchants
  ADD CONSTRAINT merchants_balance_mode_check
  CHECK (balance_mode IN ('demo', 'real'));

UPDATE public.merchants
SET
  real_balance = available_balance,
  demo_balance = available_balance
WHERE real_balance = 0 AND demo_balance = 0 AND available_balance <> 0;
