-- Simple callback log: one row per POST. Open this table in Supabase Table Editor.

CREATE TABLE IF NOT EXISTS callbacks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_ip TEXT,
  body JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS callbacks_received_at_idx
  ON callbacks (received_at DESC);
