-- Add plant column to suppliers table
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS plant text;

-- Add plant column to carriers table  
ALTER TABLE carriers ADD COLUMN IF NOT EXISTS plant text;

-- Update existing suppliers to Mercedes (since they were created for Mercedes)
UPDATE suppliers SET plant = 'mercedes' WHERE plant IS NULL;

-- Update existing carriers to Mercedes (since they were created for Mercedes)
UPDATE carriers SET plant = 'mercedes' WHERE plant IS NULL;
