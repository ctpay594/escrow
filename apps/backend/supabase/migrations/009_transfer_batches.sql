-- Bulk transfer batches: one upload → many transfer rows sharing batch_id

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

ALTER TABLE public.transfers
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES public.transfer_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS transfers_batch_id_idx ON public.transfers(batch_id);
CREATE INDEX IF NOT EXISTS transfer_batches_user_id_idx ON public.transfer_batches(user_id);
