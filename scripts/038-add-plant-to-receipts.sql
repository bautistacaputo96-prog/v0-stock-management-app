-- Add plant column to mp_receipts table
ALTER TABLE mp_receipts ADD COLUMN IF NOT EXISTS plant TEXT;

-- Set existing records to 'mercedes' as default
UPDATE mp_receipts SET plant = 'mercedes' WHERE plant IS NULL;

-- Make plant column NOT NULL after setting defaults
ALTER TABLE mp_receipts ALTER COLUMN plant SET DEFAULT 'mercedes';

-- Create index for faster filtering
CREATE INDEX IF NOT EXISTS idx_mp_receipts_plant ON mp_receipts(plant);
