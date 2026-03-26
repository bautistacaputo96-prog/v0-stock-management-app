-- Add production_line column to mp_receipts for cement tracking per line
ALTER TABLE mp_receipts ADD COLUMN IF NOT EXISTS production_line text;
