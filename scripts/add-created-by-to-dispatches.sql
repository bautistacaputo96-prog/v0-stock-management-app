-- Add created_by column to dispatches table
ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS created_by character varying;
