-- Run in Supabase Dashboard → SQL Editor
-- Creates app users table (username + password; admin-managed, backend-only DB access)

CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_username_unique UNIQUE (username),
  CONSTRAINT users_username_length CHECK (char_length(username) >= 3),
  CONSTRAINT users_password_length CHECK (char_length(password) >= 6)
);

CREATE INDEX IF NOT EXISTS users_username_idx ON public.users (username);

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- No RLS policies: only the backend service role can read/write this table.

CREATE OR REPLACE FUNCTION public.set_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON public.users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_users_updated_at();

-- Demo user: username "demo" / password "password123"
-- Replace password_hash after running POST /auth/register, or hash via backend only.
-- INSERT INTO public.users (username, password_hash)
-- VALUES ('demo', '<bcrypt-hash-from-backend>');
