-- Add plant column to pipe_production table
ALTER TABLE pipe_production ADD COLUMN IF NOT EXISTS plant text DEFAULT 'silke';

-- Set default value for existing records
UPDATE pipe_production SET plant = 'silke' WHERE plant IS NULL;
