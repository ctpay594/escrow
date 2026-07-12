-- Run in Supabase Dashboard → SQL Editor
-- Merchant profile + encrypted EscrowStack credentials (1:1 with users)

CREATE TABLE IF NOT EXISTS public.merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  merchant_name TEXT NOT NULL,
  user_ref TEXT,
  virtual_account_no TEXT,
  escrow_ifsc TEXT,
  encrypted_api_key TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  available_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  pending_balance NUMERIC(18, 2) NOT NULL DEFAULT 0,
  escrow_account_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchants_user_id_idx ON public.merchants (user_id);

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
