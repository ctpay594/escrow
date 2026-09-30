-- Run in Supabase SQL Editor (production)
CREATE TABLE IF NOT EXISTS public.login_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  realm TEXT NOT NULL CHECK (realm IN ('user', 'admin')),
  username TEXT,
  user_id UUID,
  success BOOLEAN NOT NULL,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_events_created_at_idx
  ON public.login_events (created_at DESC);
CREATE INDEX IF NOT EXISTS login_events_username_idx
  ON public.login_events (username, created_at DESC);
CREATE INDEX IF NOT EXISTS login_events_ip_idx
  ON public.login_events (ip, created_at DESC);
