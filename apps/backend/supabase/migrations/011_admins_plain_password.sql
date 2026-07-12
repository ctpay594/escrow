-- Run in Supabase Dashboard → SQL Editor
-- Switches admins from bcrypt hash to plain password (editable in Supabase, backend-only access)

ALTER TABLE public.admins ADD COLUMN IF NOT EXISTS password TEXT;

-- Bcrypt hashes cannot be converted back to plain text.
ALTER TABLE public.admins DROP COLUMN IF EXISTS password_hash;

-- Remove admins without a plain password (re-bootstrap or insert manually after migration).
DELETE FROM public.admins WHERE password IS NULL;

ALTER TABLE public.admins ALTER COLUMN password SET NOT NULL;

ALTER TABLE public.admins DROP CONSTRAINT IF EXISTS admins_password_length;
ALTER TABLE public.admins ADD CONSTRAINT admins_password_length
  CHECK (char_length(password) >= 6);
