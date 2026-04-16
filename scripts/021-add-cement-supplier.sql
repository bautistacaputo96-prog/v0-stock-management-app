-- Add cement_supplier column to paston_formulas
ALTER TABLE paston_formulas 
ADD COLUMN IF NOT EXISTS cement_supplier TEXT;
