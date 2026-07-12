-- Bank reference fields for webhook / payout status reconciliation

ALTER TABLE public.transfers
  ADD COLUMN IF NOT EXISTS utr TEXT,
  ADD COLUMN IF NOT EXISTS bank_ref TEXT;

CREATE INDEX IF NOT EXISTS transfers_utr_idx ON public.transfers (utr)
  WHERE utr IS NOT NULL;
