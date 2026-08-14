-- Platform EscrowStack keys live in backend .env, not per merchant.

ALTER TABLE merchants
  DROP COLUMN IF EXISTS encrypted_api_key,
  DROP COLUMN IF EXISTS encrypted_private_key;
