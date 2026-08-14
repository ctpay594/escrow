-- Unique virtual accounts (CHAK69xxxxxx) per merchant

CREATE UNIQUE INDEX IF NOT EXISTS merchants_virtual_account_no_unique
  ON merchants (virtual_account_no)
  WHERE virtual_account_no IS NOT NULL;
