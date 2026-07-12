ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS balance_mode TEXT NOT NULL DEFAULT 'demo';

ALTER TABLE merchants
  DROP CONSTRAINT IF EXISTS merchants_balance_mode_check;

ALTER TABLE merchants
  ADD CONSTRAINT merchants_balance_mode_check
  CHECK (balance_mode IN ('demo', 'real'));
