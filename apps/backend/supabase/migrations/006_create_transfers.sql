-- Transfer requests: user portal submits → PENDING_APPROVAL until admin approves

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transfers_user_id_idx ON public.transfers (user_id);
CREATE INDEX IF NOT EXISTS transfers_merchant_id_idx ON public.transfers (merchant_id);
CREATE INDEX IF NOT EXISTS transfers_status_idx ON public.transfers (status);
CREATE INDEX IF NOT EXISTS transfers_created_at_idx ON public.transfers (created_at DESC);

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
