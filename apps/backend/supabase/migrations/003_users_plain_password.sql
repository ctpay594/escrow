-- Run in Supabase Dashboard → SQL Editor
-- Switches users from bcrypt hash to plain password (admin-visible, backend-only access)

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password TEXT;

-- Bcrypt hashes cannot be converted back to plain text.
ALTER TABLE public.users DROP COLUMN IF EXISTS password_hash;

-- Remove users without a password (recreate them in admin portal after migration).
DELETE FROM public.users WHERE password IS NULL;

ALTER TABLE public.users ALTER COLUMN password SET NOT NULL;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_password_length;
ALTER TABLE public.users ADD CONSTRAINT users_password_length
  CHECK (char_length(password) >= 6);
