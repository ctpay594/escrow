-- Add request metadata to webhook_events (if 012 was already applied without these columns)

ALTER TABLE webhook_events
  ADD COLUMN IF NOT EXISTS remote_ip TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS request_headers JSONB;

CREATE INDEX IF NOT EXISTS webhook_events_remote_ip_idx
  ON webhook_events (remote_ip);
