-- Migration 057: per-user switch for receipt scanning.
-- Off by default: the model call is paid from the owner's key, and Telegram
-- signup is open, so only the owner turns it on, directly in the database.
ALTER TABLE budgeting.users
    ADD COLUMN IF NOT EXISTS receipt_scan_enabled boolean NOT NULL DEFAULT false;
