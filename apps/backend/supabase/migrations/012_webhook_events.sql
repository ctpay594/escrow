-- EscrowStack webhook audit log (payout status, deposits, unknown payloads)

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL DEFAULT 'escrowstack',
  event_type TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  payout_ref TEXT,
  merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  remote_ip TEXT,
  user_agent TEXT,
  request_headers JSONB,
  signature_valid BOOLEAN,
  processed BOOLEAN NOT NULL DEFAULT false,
  process_result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_events_payout_ref_idx
  ON webhook_events (payout_ref);

CREATE INDEX IF NOT EXISTS webhook_events_created_at_idx
  ON webhook_events (created_at DESC);

CREATE INDEX IF NOT EXISTS webhook_events_remote_ip_idx
  ON webhook_events (remote_ip);
