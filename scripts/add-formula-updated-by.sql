-- Add updated_by column to formulas table to track who edited the formula
ALTER TABLE formulas ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255);

-- Add comment to column
COMMENT ON COLUMN formulas.updated_by IS 'Name of the person who last edited the formula';
