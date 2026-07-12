-- Run in Supabase Dashboard → SQL Editor
-- Separate admin accounts for admin-portal (not end users)

CREATE TABLE IF NOT EXISTS public.admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT admins_username_unique UNIQUE (username),
  CONSTRAINT admins_username_length CHECK (char_length(username) >= 3)
);

CREATE INDEX IF NOT EXISTS admins_username_idx ON public.admins (username);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- No RLS policies: only the backend service role can read/write this table.

CREATE OR REPLACE FUNCTION public.set_admins_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admins_set_updated_at ON public.admins;
CREATE TRIGGER admins_set_updated_at
  BEFORE UPDATE ON public.admins
  FOR EACH ROW
  EXECUTE FUNCTION public.set_admins_updated_at();

-- First admin: use POST /admin/auth/bootstrap (when table is empty) or insert a bcrypt hash manually.
