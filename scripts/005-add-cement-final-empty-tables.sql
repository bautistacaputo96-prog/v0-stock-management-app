-- Add cement at end of shift and empty tables to block_production table
ALTER TABLE block_production
ADD COLUMN IF NOT EXISTS cement_final_shift_tn DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS empty_tables INTEGER;
